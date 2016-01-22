#include <nan.h>
#include <stdio.h>
#include <stdlib.h>
#include <assert.h>
#include <string.h>
#include <errno.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <poll.h>
#include <netdb.h>
#include <signal.h>

#include <uv.h>
#include "deps/libutp/utp.h"

#define LOCAL_STRING(s) Nan::New<String>(s).ToLocalChecked()
#define LOOKUP_CALLBACK(map, name) map->Has(LOCAL_STRING(name)) ? new Nan::Callback(map->Get(LOCAL_STRING(name)).As<Function>()) : NULL
#define BUFFER_SIZE 65535

using namespace v8;

typedef struct {
  int ptr;
  int fd;
  char *buf;
  int needs_drain;

  int write_buf_size;
  utp_iovec *write_buf;
  int write_top;
  int write_btm;

  utp_context *context;
  utp_socket *socket;

  uv_poll_t *handle;
  uv_timer_t *timeouts;

  Nan::Callback *on_read;
  Nan::Callback *on_drain;
  Nan::Callback *on_destroying;
  Nan::Callback *on_connect;
  Nan::Callback *on_eof;
  Nan::Callback *on_error;
  Nan::Callback *on_socket;
} node_utp_t;

// hack for now
static node_utp_t *utp_sockets[1024];
static uint32_t utp_sockets_count = 0;

static node_utp_t *node_utp_alloc () {
  node_utp_t *self = (node_utp_t *) malloc(sizeof(node_utp_t));

  self->buf = NULL;
  self->fd = 0;
  self->handle = NULL;
  self->timeouts = NULL;
  self->write_buf_size = 16; // must to power of 2
  self->write_buf = (utp_iovec *) malloc(self->write_buf_size * sizeof(utp_iovec));
  self->ptr = utp_sockets_count++;;
  self->write_top = 0;
  self->write_btm = 0;
  self->needs_drain = 0;
  self->on_read = NULL;
  self->on_connect = NULL;
  self->on_destroying = NULL;
  self->on_drain = NULL;
  self->on_eof = NULL;
  self->on_error = NULL;
  self->on_socket = NULL;

  utp_sockets[self->ptr] = self;

  return self;
}

static int node_utp_write_buffer (node_utp_t *self, char *data, size_t len) {
  int mask = self->write_buf_size - 1;
  int next = (self->write_top + 1) & mask;

  if (self->write_btm == next) {
    utp_iovec *new_buffer = (utp_iovec *) malloc(2 * self->write_buf_size * sizeof(utp_iovec));
    if (!new_buffer) return -1;

    next = 0;
    for (int i = self->write_btm; i != self->write_top; i = (i + 1) & mask) {
      new_buffer[next++] = self->write_buf[i];
    }

    free(self->write_buf);
    self->write_buf = new_buffer;
    self->write_buf_size *= 2;
    self->write_btm = 0;
    self->write_top = next;
    next++;
  }

  utp_iovec *buf = &(self->write_buf[self->write_top]);
  buf->iov_len = len;
  buf->iov_base = data;

  self->write_top = next;
  return 0;
}

static void node_utp_on_drain (node_utp_t *self) {
  Nan::HandleScope scope;
  self->needs_drain = 0;
  if (self->on_drain) self->on_drain->Call(0, NULL);
}

static int node_utp_write_flush (node_utp_t *self) {
  while (self->write_top != self->write_btm) {
    utp_iovec *buf = &(self->write_buf[self->write_btm]);

    // TODO: use utp_writev for this :)
    int sent = utp_write(self->socket, buf->iov_base, buf->iov_len);
    if (sent <= 0) {
      self->needs_drain = 1;
      return 0;
    }

    buf->iov_len = buf->iov_len - sent;
    buf->iov_base = ((char *) buf->iov_base) + sent;

    if (!buf->iov_len) self->write_btm = (self->write_btm + 1) & (self->write_buf_size - 1);
  }

  if (self->needs_drain) node_utp_on_drain(self);
  return 1;
}

static void node_utp_on_readable (uv_poll_t *req, int status, int events) {
  node_utp_t *self = (node_utp_t *) req->data;

  if (events & UV_READABLE) {
    struct sockaddr_in src_addr;
    socklen_t addrlen = sizeof(src_addr);
    ssize_t len;

    while (1) {
      len = recvfrom(self->fd, self->buf, BUFFER_SIZE, MSG_DONTWAIT, (struct sockaddr *)&src_addr, &addrlen);
      if (len < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
          utp_issue_deferred_acks(self->context);
          break;
        }

        printf("CRITICIAL ERROR\n"); // yolo
        exit(1);
      }

      utp_process_udp(self->context, (const unsigned char *) self->buf, len, (struct sockaddr *)&src_addr, addrlen);
    }
  }
}

static void node_utp_check_timeouts (uv_timer_t *req) {
  node_utp_t *self = (node_utp_t *) req->data;
  utp_check_timeouts(self->context);
}

static uint64 callback_on_read (utp_callback_arguments *a) {
  Nan::HandleScope scope;
  node_utp_t *self = (node_utp_t *) utp_get_userdata(a->socket);

  if (self->on_read) {
    Local<Value> argv[] = {
      Nan::CopyBuffer((const char *) a->buf, a->len).ToLocalChecked()
    };
    self->on_read->Call(1, argv);
  }

  utp_read_drained(a->socket);
  return 0;
}

static uint64 callback_on_state_change (utp_callback_arguments *a) {
  Nan::HandleScope scope;
  node_utp_t *self = (node_utp_t *) utp_get_userdata(a->socket);

  switch (a->state) {
    case UTP_STATE_CONNECT:
      if (self->on_connect) self->on_connect->Call(0, NULL);
      node_utp_write_flush(self);
      break;

    case UTP_STATE_WRITABLE:
      node_utp_write_flush(self);
      break;

    case UTP_STATE_EOF:
      if (self->on_eof) self->on_eof->Call(0, NULL);
      break;

    case UTP_STATE_DESTROYING:
      if (self->fd) {
        uv_timer_stop(self->timeouts);
        free(self->timeouts);
        self->timeouts = NULL;
        uv_poll_stop(self->handle);
        free(self->handle);
        self->handle = NULL;
      }
      if (self->buf) {
        free(self->buf);
        self->buf = NULL;
      }
      if (self->write_buf) {
        free(self->write_buf);
        self->write_buf = NULL;
      }

      // if (self->on_destroying) self->on_destroying->Call(0, NULL);
      break;
  }

  return 0;
}

static uint64 callback_sendto (utp_callback_arguments *a) {
  node_utp_t *self = (node_utp_t *) utp_context_get_userdata(a->context);
  sendto(self->fd, a->buf, a->len, 0, a->address, a->address_len);
  return 0;
}

static uint64 callback_on_error (utp_callback_arguments *a) {
  Nan::HandleScope scope;
  node_utp_t *self = (node_utp_t *) utp_get_userdata(a->socket);
  if (self->on_error) self->on_error->Call(0, NULL);
  return 0;
}

static uint64 callback_on_accept (utp_callback_arguments *a) {
  Nan::HandleScope scope;
  node_utp_t *self = (node_utp_t *) utp_context_get_userdata(a->context);

  if (self->on_socket) {
    node_utp_t *client = node_utp_alloc();
    client->socket = a->socket;
    client->context = a->context;
    utp_set_userdata(a->socket, client);

    Local<Value> argv[] = {Nan::New<Number>(client->ptr)};
    self->on_socket->Call(1, argv);
  }

  return 0;
}

static uint64 callback_on_firewall (utp_callback_arguments *a) {
  node_utp_t *self = (node_utp_t *) utp_context_get_userdata(a->context);
  if (!self->on_socket) return 1;
  return 0;
}

static uint64 callback_log (utp_callback_arguments *a) {
  fprintf(stderr, "log: %s\n", a->buf);
  return 0;
}

static int node_utp_bind (node_utp_t *self, char *localAddr, char *localPort, char *remoteAddr, char *remotePort) {
  struct addrinfo hints, *res;
  struct sockaddr_in sin;

  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_DGRAM;
  hints.ai_protocol = IPPROTO_UDP;

  self->fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (self->fd < 0) return -1;

  self->handle = (uv_poll_t *) malloc(sizeof(uv_poll_t));
  self->timeouts = (uv_timer_t *) malloc(sizeof(uv_timer_t));

  if (getaddrinfo(localAddr, localPort, &hints, &res)) return -1;
  if (bind(self->fd, res->ai_addr, res->ai_addrlen)) return -1;

  freeaddrinfo(res);
  socklen_t len = sizeof(sin);
  if (getsockname(self->fd, (struct sockaddr *) &sin, &len) != 0) return -1;
  int port = ntohs(sin.sin_port);

  self->context = utp_init(2);
  utp_context_set_userdata(self->context, self);

  utp_set_callback(self->context, UTP_SENDTO, &callback_sendto);
  utp_set_callback(self->context, UTP_ON_READ, &callback_on_read);
  utp_set_callback(self->context, UTP_ON_STATE_CHANGE, &callback_on_state_change);
  utp_set_callback(self->context, UTP_ON_ERROR, &callback_on_error);
  utp_set_callback(self->context, UTP_ON_FIREWALL, &callback_on_firewall);
  utp_set_callback(self->context, UTP_ON_ACCEPT, &callback_on_accept);
  utp_set_callback(self->context, UTP_LOG, &callback_log);

  // utp_context_set_option(self->context, UTP_LOG_DEBUG,  1);

  if (remoteAddr != NULL) {
    self->socket = utp_create_socket(self->context);
    utp_set_userdata(self->socket, self);
    if (getaddrinfo(remoteAddr, remotePort, &hints, &res)) return -1;

    utp_connect(self->socket, res->ai_addr, res->ai_addrlen);
    freeaddrinfo(res);
  }

  self->handle->data = self;
  uv_poll_init(uv_default_loop(), self->handle, self->fd);
  uv_poll_start(self->handle, UV_READABLE, node_utp_on_readable);

  self->timeouts->data = self;
  uv_timer_init(uv_default_loop(), self->timeouts);
  uv_timer_start(self->timeouts, node_utp_check_timeouts, 50, 50);

  return port;
}

NAN_METHOD(Create) {
  node_utp_t *self = node_utp_alloc();
  self->buf = (char *) malloc(4096);
  info.GetReturnValue().Set(self->ptr);
}

NAN_METHOD(Callbacks) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];
  Local<Object> ops = info[1].As<Object>();

  self->on_read = LOOKUP_CALLBACK(ops, "onread");
  self->on_connect = LOOKUP_CALLBACK(ops, "onconnect");
  self->on_destroying = LOOKUP_CALLBACK(ops, "ondestroying");
  self->on_eof = LOOKUP_CALLBACK(ops, "oneof");
  self->on_error = LOOKUP_CALLBACK(ops, "onerror");
  self->on_socket = LOOKUP_CALLBACK(ops, "onsocket");
  self->on_drain = LOOKUP_CALLBACK(ops, "ondrain");
}

NAN_METHOD(Connect) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];

  int boundPort;
  Nan::Utf8String port(info[1]);
  Nan::Utf8String host(info[2]);
  Nan::Utf8String localPort(info[3]);
  Nan::Utf8String localHost(info[4]);

  boundPort = node_utp_bind(self, *localHost, *localPort, *host, *port);
  if (boundPort < 0) Nan::ThrowError(Nan::ErrnoException(errno));
  else info.GetReturnValue().Set(boundPort);
}

NAN_METHOD(Pause) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];
  uv_poll_stop(self->handle);
}

NAN_METHOD(Resume) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];
  uv_poll_start(self->handle, UV_READABLE, node_utp_on_readable);
}

NAN_METHOD(Listen) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];

  int boundPort;
  Nan::Utf8String port(info[1]);
  Nan::Utf8String host(info[2]);

  boundPort = node_utp_bind(self, *host, *port, NULL, NULL);
  if (boundPort < 0) Nan::ThrowError(Nan::ErrnoException(errno));
  else info.GetReturnValue().Set(boundPort);
}

NAN_METHOD(SendBulk) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];
  Local<Array> buffers = info[1].As<Array>();
  for (uint32_t i = 0; i < buffers->Length(); i++) {
    Local<Object> bufObj = buffers->Get(i)->ToObject();
    size_t len = node::Buffer::Length(bufObj);
    char *data = node::Buffer::Data(bufObj);

    if (node_utp_write_buffer(self, data, len) < 0) {
      Nan::ThrowError("Write buffer cannot be expanded");
      return;
    }
  }

  if (node_utp_write_flush(self)) info.GetReturnValue().Set(Nan::True());
  else info.GetReturnValue().Set(Nan::False());
}

NAN_METHOD(Send) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];
  Local<Object> bufObj = info[1]->ToObject();
  size_t len = node::Buffer::Length(bufObj);
  char *data = node::Buffer::Data(bufObj);

  if (node_utp_write_buffer(self, data, len) < 0) {
    Nan::ThrowError("Write buffer cannot be expanded");
    return;
  }

  if (node_utp_write_flush(self)) info.GetReturnValue().Set(Nan::True());
  else info.GetReturnValue().Set(Nan::False());
}

NAN_METHOD(Destroy) {
  node_utp_t *self = utp_sockets[info[0]->Uint32Value()];
  utp_close(self->socket);
}

NAN_MODULE_INIT(InitAll) {
  Nan::Set(target, Nan::New<String>("create").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Create)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("callbacks").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Callbacks)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("listen").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Listen)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("connect").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Connect)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("pause").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Pause)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("resume").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Resume)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("send").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Send)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("sendBulk").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(SendBulk)).ToLocalChecked());
  Nan::Set(target, Nan::New<String>("destroy").ToLocalChecked(), Nan::GetFunction(Nan::New<FunctionTemplate>(Destroy)).ToLocalChecked());
}

NODE_MODULE(utp, InitAll)
