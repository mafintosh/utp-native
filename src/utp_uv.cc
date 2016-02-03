#include "utp_uv.h"
#include <stdio.h>
#include <stdlib.h>

#ifndef _WIN32
# include <unistd.h>
#endif

#define UTP_UV_TIMEOUT_INTERVAL 500

static void
DEBUG (const char *msg) {
  fprintf(stderr, "debug utp_uv: %s\n", msg);
}

static void
on_uv_close (uv_handle_t *handle) {
  utp_uv_t *self = (utp_uv_t *) handle->data;
  if (self->context) {
    utp_destroy(self->context);
    self->context = NULL;
    if (self->on_close) self->on_close(self);
  }
}

static void
really_destroy (utp_uv_t *self) {
  uv_udp_t *handle = &(self->handle);
  uv_timer_t *timer = &(self->timer);

  // TODO: do these need error handling?
  uv_timer_stop(timer);
  uv_udp_recv_stop(handle);
  uv_close((uv_handle_t *) handle, on_uv_close);
}

static void
on_uv_alloc (uv_handle_t* handle, size_t suggested_size, uv_buf_t* buf) {
  utp_uv_t *self = (utp_uv_t *) handle->data;
  buf->base = (char *) &(self->buffer);
  buf->len = UTP_UV_BUFFER_SIZE;
}

static void
on_uv_read (uv_udp_t* handle, ssize_t nread, const uv_buf_t* buf, const struct sockaddr* addr, unsigned flags) {
  utp_uv_t *self = (utp_uv_t *) handle->data;
  int ret;

  if (nread < 0) {
    if (self->on_error) self->on_error(self);
    return;
  }

  if (nread == 0) {
    utp_issue_deferred_acks(self->context);
    return;
  }

  ret = utp_process_udp(self->context, (const unsigned char *) buf->base, nread, addr, sizeof(struct sockaddr));
  if (ret) return;

  // not a utp message -> call on_message
  if (!self->on_message) return;

  struct sockaddr_in *addr_in = (struct sockaddr_in *) addr;
  int port = ntohs(addr_in->sin_port);
  char ip[17];
  uv_ip4_name(addr_in, (char *) &ip, 17);
  self->on_message(self, buf->base, (size_t) nread, port, (char *) &ip);
}

static void
on_uv_interval (uv_timer_t *req) {
  utp_uv_t *self = (utp_uv_t *) req->data;
  utp_check_timeouts(self->context);
}

static uint64
on_utp_read (utp_callback_arguments *a) {
  utp_uv_t *self = (utp_uv_t *) utp_context_get_userdata(a->context);
  if (self->on_socket_read) self->on_socket_read(self, a->socket, (char *) a->buf, a->len);
  utp_read_drained(a->socket);
  return 0;
}

static uint64
on_utp_state_change (utp_callback_arguments *a) {
  utp_uv_t *self = (utp_uv_t *) utp_context_get_userdata(a->context);

  switch (a->state) {
    case UTP_STATE_CONNECT:
      if (self->on_socket_connect) self->on_socket_connect(self, a->socket);
      break;

    case UTP_STATE_WRITABLE:
      if (self->on_socket_writable) self->on_socket_writable(self, a->socket);
      break;

    case UTP_STATE_EOF:
      if (self->on_socket_end) self->on_socket_end(self, a->socket);
      break;

    case UTP_STATE_DESTROYING:
      self->sockets--;
      if (!self->sockets && self->destroyed) really_destroy(self);
      if (self->on_socket_close) self->on_socket_close(self, a->socket);
      break;

    default:
      DEBUG("unknown state change");
      break;
  }

  return 0;
}

static uint64
on_utp_log (utp_callback_arguments *a) {
  DEBUG((const char *) a->buf);
  return 0;
}

static uint64
on_utp_accept (utp_callback_arguments *a) {
  utp_uv_t *self = (utp_uv_t *) utp_context_get_userdata(a->context);
  if (!self->on_socket) return 0;
  self->sockets++;
  self->on_socket(self, a->socket);
  return 0;
}

static uint64
on_utp_firewall (utp_callback_arguments *a) {
  utp_uv_t *self = (utp_uv_t *) utp_context_get_userdata(a->context);
  if (!self->on_socket || self->firewalled) return 1;
  return 0;
}

static uint64
on_utp_sendto (utp_callback_arguments *a) {
  utp_uv_t *self = (utp_uv_t *) utp_context_get_userdata(a->context);

  uv_buf_t buf = {
    .base = (char *) a->buf,
    .len = a->len
  };

  uv_udp_try_send(&(self->handle), &buf, 1, a->address);
  return 0;
}

static uint64
on_utp_error (utp_callback_arguments *a) {
  utp_uv_t *self = (utp_uv_t *) utp_context_get_userdata(a->context);
  utp_socket *socket = a->socket;
  if (self->on_socket_error) self->on_socket_error(self, socket, a->error_code);
  return 0;
}

int
utp_uv_init (utp_uv_t *self) {
  int ret;
  uv_udp_t *handle = &(self->handle);
  uv_timer_t *timer = &(self->timer);

  // clear state
  self->firewalled = 0;
  self->sockets = 0;
  self->destroyed = 0;
  self->on_message = NULL;
  self->on_error = NULL;
  self->on_close = NULL;
  self->on_socket = NULL;
  self->on_socket_error = NULL;
  self->on_socket_read = NULL;
  self->on_socket_writable = NULL;
  self->on_socket_end = NULL;
  self->on_socket_close = NULL;
  self->on_socket_connect = NULL;

  // init utp
  self->context = utp_init(2);

  utp_context_set_userdata(self->context, self);

  utp_set_callback(self->context, UTP_ON_STATE_CHANGE, &on_utp_state_change);
  utp_set_callback(self->context, UTP_ON_READ, &on_utp_read);
  utp_set_callback(self->context, UTP_ON_FIREWALL, &on_utp_firewall);
  utp_set_callback(self->context, UTP_ON_ACCEPT, &on_utp_accept);
  utp_set_callback(self->context, UTP_SENDTO, &on_utp_sendto);
  utp_set_callback(self->context, UTP_ON_ERROR, &on_utp_error);

  ret = uv_timer_init(uv_default_loop(), timer);
  if (ret) return ret;

  ret = uv_udp_init(uv_default_loop(), handle);
  if (ret) return ret;

  handle->data = self;
  timer->data = self;

  return 0;
}

utp_socket_stats*
utp_uv_socket_stats (utp_uv_t *self, utp_socket *socket) {
  return utp_get_stats(socket);
}

utp_socket *
utp_uv_connect (utp_uv_t *self, int port, char *ip) {
  struct sockaddr_in addr;
  int ret;

  ret = uv_ip4_addr((const char *) (ip == NULL ? "127.0.0.1" : ip), port, &addr);
  if (ret) return NULL;

  utp_socket *socket = utp_create_socket(self->context);
  if (socket == NULL) return NULL;

  ret = utp_connect(socket, (struct sockaddr *) &addr, sizeof(struct sockaddr_in));
  if (ret) return NULL;

  self->sockets++;

  return socket;
}

void
utp_uv_debug (utp_uv_t *self) {
  utp_context_set_option(self->context, UTP_LOG_DEBUG, 1);
  utp_set_callback(self->context, UTP_LOG, &on_utp_log);
}

int
utp_uv_bind (utp_uv_t *self, int port, char *ip) {
  struct sockaddr_in addr;
  int ret;
  uv_udp_t *handle = &(self->handle);
  uv_timer_t *timer = &(self->timer);

  ret = uv_ip4_addr((const char *) (ip == NULL ? "0.0.0.0" : ip), port, &addr);
  if (ret) return ret;

  ret = uv_udp_bind(handle, (const struct sockaddr*) &addr, 0);
  if (ret) return ret;

  ret = uv_udp_recv_start(handle, on_uv_alloc, on_uv_read);
  if (ret) return ret;

  ret = uv_timer_start(timer, on_uv_interval, UTP_UV_TIMEOUT_INTERVAL, UTP_UV_TIMEOUT_INTERVAL);
  if (ret) return ret;

  return 0;
}

int
utp_uv_address (utp_uv_t *self, int *port, char *ip) {
  int ret;
  uv_udp_t *handle = &(self->handle);
  struct sockaddr name;
  int name_len = sizeof(name);

  ret = uv_udp_getsockname(handle, &name, &name_len);
  if (ret) return ret;

  struct sockaddr_in *name_in = (struct sockaddr_in *) &name;
  *port = ntohs(name_in->sin_port);
  if (ip != NULL) uv_ip4_name(name_in, ip, 17);

  return 0;
}

int
utp_uv_socket_writev (utp_uv_t *self, utp_socket *socket, struct utp_iovec *bufs, size_t bufs_len) {
  return utp_writev(socket, bufs, bufs_len);
}

int
utp_uv_socket_write (utp_uv_t *self, utp_socket *socket, char *data, size_t len) {
  return utp_write(socket, data, len);
}

void
utp_uv_socket_end (utp_uv_t *self, utp_socket *socket) {
  utp_close(socket);
}

void
utp_uv_ref (utp_uv_t *self) {
  uv_ref((uv_handle_t *) &(self->handle));
  uv_ref((uv_handle_t *) &(self->timer));
}

void
utp_uv_unref (utp_uv_t *self) {
  uv_unref((uv_handle_t *) &(self->handle));
  uv_unref((uv_handle_t *) &(self->timer));
}

void
utp_uv_destroy (utp_uv_t *self) {
  if (self->destroyed) return;
  self->destroyed = 1;
  self->on_socket = NULL;
  if (!self->sockets) really_destroy(self);
}

int
utp_uv_send (utp_uv_t *self, char *data, size_t len, int port, char *ip) {
  int ret;
  struct sockaddr_in addr;

  uv_udp_t *handle = &(self->handle);
  ret = uv_ip4_addr((const char *) (ip == NULL ? "127.0.0.1" : ip), port, &addr);
  if (ret) return -1;

  uv_buf_t buf = {
    .base = data,
    .len = len
  };

  return uv_udp_try_send(handle, (const uv_buf_t *) &buf, 1, (const struct sockaddr *) &addr);
}

// int
// utp_uv_send_buffered (utp_uv_t *self, uv_udp_send_t* req, char *data, size_t len, int port, char *ip, uv_udp_send_cb callback) {
//   int ret;
//   struct sockaddr_in addr;

//   uv_udp_t *handle = &(self->handle);
//   ret = uv_ip4_addr((const char *) (ip == NULL ? "127.0.0.1" : ip), port, &addr);
//   if (ret) return -1;

//   uv_buf_t buf = {
//     .base = data,
//     .len = len
//   };

//   return uv_udp_send(req, &(self->handle), &buf, 1);
// }
