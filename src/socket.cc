#include <uv.h>
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

#include "socket.h"
#include "../deps/libutp/utp.h"

namespace utp_native {

NAN_METHOD(Build) {
  NanScope();
  NanReturnValue(UTPSocket::NewInstance());
}

Persistent<FunctionTemplate> UTPSocket::utp_socket_constructor;

UTPSocket::UTPSocket () {
  read_buffer_ = (unsigned char *) malloc(4096);
  handle_ = NULL;
  socket_ = NULL;
  context_ = NULL;
  write_buffer_.data = NULL;
  write_buffer_.length = 0;
}

UTPSocket::~UTPSocket () {
  printf("gc\n");
  free(read_buffer_);
}

void UTPSocket::Init() {
  Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(UTPSocket::New);
  NanAssignPersistent(utp_socket_constructor, tpl);
  tpl->SetClassName(NanNew("UTPSocket"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  NODE_SET_PROTOTYPE_METHOD(tpl, "connect", UTPSocket::Connect);
  NODE_SET_PROTOTYPE_METHOD(tpl, "listen", UTPSocket::Listen);
  NODE_SET_PROTOTYPE_METHOD(tpl, "handlers", UTPSocket::Handlers);
  NODE_SET_PROTOTYPE_METHOD(tpl, "write", UTPSocket::Write);
  NODE_SET_PROTOTYPE_METHOD(tpl, "close", UTPSocket::Close);
}

NAN_METHOD(UTPSocket::New) {
  NanScope();

  UTPSocket* obj = new UTPSocket();
  obj->Wrap(args.This());

  NanReturnValue(args.This());
}

NAN_METHOD(UTPSocket::Handlers) {
  NanScope();

  UTPSocket* self = node::ObjectWrap::Unwrap<UTPSocket>(args.This());
  Local<Object> handlers = args[0].As<Object>();

  self->on_connect = handlers->Has(NanNew<String>("onconnect")) ? new NanCallback(handlers->Get(NanNew<String>("onconnect")).As<Function>()) : NULL;
  self->on_read = handlers->Has(NanNew<String>("onread")) ? new NanCallback(handlers->Get(NanNew<String>("onread")).As<Function>()) : NULL;
  self->on_eof = handlers->Has(NanNew<String>("oneof")) ? new NanCallback(handlers->Get(NanNew<String>("oneof")).As<Function>()) : NULL;
  self->on_socket = handlers->Has(NanNew<String>("onsocket")) ? new NanCallback(handlers->Get(NanNew<String>("onsocket")).As<Function>()) : NULL;
  self->on_destroying = handlers->Has(NanNew<String>("ondestroying")) ? new NanCallback(handlers->Get(NanNew<String>("ondestroying")).As<Function>()) : NULL;
  self->on_drain = handlers->Has(NanNew<String>("ondrain")) ? new NanCallback(handlers->Get(NanNew<String>("ondrain")).As<Function>()) : NULL;
  self->on_error = handlers->Has(NanNew<String>("onerror")) ? new NanCallback(handlers->Get(NanNew<String>("onerror")).As<Function>()) : NULL;

  NanReturnUndefined();
}

Handle<Value> UTPSocket::NewInstance () {
  NanEscapableScope();
  Local<FunctionTemplate> constructorHandle = NanNew<FunctionTemplate>(utp_socket_constructor);
  Local<Object> instance = constructorHandle->GetFunction()->NewInstance(0, NULL);
  return NanEscapeScope(instance);
}

static void check_timeouts (uv_timer_t *req) {
  UTPSocket* self = (UTPSocket*) req->data;
  utp_check_timeouts(self->context_);
}

static void write_flush (UTPSocket *self) {
  char* data = self->write_buffer_.data;
  size_t length = self->write_buffer_.length;
  size_t sent = utp_write(self->socket_, data, length);

  if (sent != length) {
    self->write_buffer_.data += sent;
    self->write_buffer_.length -= sent;
    return;
  }

  self->on_drain->Call(0, NULL);
}

uint64 callback_on_read (utp_callback_arguments *a) {
  UTPSocket *self = (UTPSocket*) utp_get_userdata(a->socket);

  if (self->on_read) {
    Local<Value> argv[] = {
      NanNewBufferHandle((const char *) a->buf, a->len), // TODO: DON'T COPY!!
      NanNew<Number>(a->len)
    };
    self->on_read->Call(2, argv);
  }

  utp_read_drained(a->socket);
  return 0;
}

uint64 callback_on_firewall (utp_callback_arguments *a) {
  UTPSocket *self = (UTPSocket*) utp_context_get_userdata(a->context);
  if (!self->on_socket) return 1;
  return 0;
}

uint64 callback_on_accept (utp_callback_arguments *a) {
  UTPSocket *self = (UTPSocket*) utp_context_get_userdata(a->context);

  if (self->on_socket) {
    // TODO: local is gc'ed when???
    Local<Value> socketInstance = NanNew(UTPSocket::NewInstance());
    UTPSocket* socketSelf = node::ObjectWrap::Unwrap<UTPSocket>(socketInstance->ToObject());
    socketSelf->socket_ = a->socket;
    utp_set_userdata(a->socket, socketSelf);
    Local<Value> argv[] = {socketInstance};
    self->on_socket->Call(1, argv);
  }

  return 0;
}

uint64 callback_on_error (utp_callback_arguments *a) {
  UTPSocket *self = (UTPSocket*) utp_get_userdata(a->socket);
  if (self->on_error) self->on_error->Call(0, NULL);
  return 0;
}

uint64 callback_on_state_change (utp_callback_arguments *a) {
  UTPSocket *self = (UTPSocket*) utp_get_userdata(a->socket);

  switch (a->state) {
    case UTP_STATE_CONNECT:
      if (self->on_connect) self->on_connect->Call(0, NULL);
      break;

    case UTP_STATE_WRITABLE:
      write_flush(self);
      break;

    case UTP_STATE_EOF:
      if (self->on_eof) self->on_eof->Call(0, NULL);
      break;

    case UTP_STATE_DESTROYING:
      if (self->on_destroying) self->on_destroying->Call(0, NULL);
      break;
  }

  return 0;
}

uint64 callback_sendto (utp_callback_arguments *a) {
  UTPSocket *self = (UTPSocket*) utp_context_get_userdata(a->context);
  sendto(self->fd_, a->buf, a->len, 0, a->address, a->address_len);
  return 0;
}

uint64 callback_log (utp_callback_arguments *a) {
  // fprintf(stderr, "log: %s\n", a->buf);
  return 0;
}

static void poll_worker (uv_poll_t *req, int status, int events) {
  UTPSocket* self = (UTPSocket*) req->data;

  if (status < 0) {
    printf("CRITICIAL ERROR 1\n"); // yolo
    exit(1);
  }

  if (events & UV_READABLE) {
    struct sockaddr_in src_addr;
    socklen_t addrlen = sizeof(src_addr);
    ssize_t len;

    while (1) {
      len = recvfrom(self->fd_, self->read_buffer_, 4096, MSG_DONTWAIT, (struct sockaddr *)&src_addr, &addrlen);
      if (len < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
          utp_issue_deferred_acks(self->context_);
          break;
        }

        printf("CRITICIAL ERROR 2\n"); // yolo
        exit(1);
      }

      utp_process_udp(self->context_, self->read_buffer_, len, (struct sockaddr *)&src_addr, addrlen);
    }
  }

  // TODO: is udp (sendto) ever blocking??
  // if (events & UV_WRITABLE) {
  //   uv_poll_start(self->handle_, UV_READABLE, poll_worker);
  //   utp_write(self->socket_,(void *) "hello\n", 6);
  // }
}

NAN_METHOD(UTPSocket::Writev) {
  NanScope();
  // UTPSocket* self = node::ObjectWrap::Unwrap<UTPSocket>(args.This());

  // Local<Object> buf = args[0].As<Object>();
  // char *data = node::Buffer::Data(buf);
  // size_t len = node::Buffer::Length(buf);

  // if (self->write_buffer_ptr_) {
  //   self->
  // }
  // printf("ptr is %i\n", len);

  NanReturnUndefined();
}

NAN_METHOD(UTPSocket::Write) {
  NanScope();
  UTPSocket* self = node::ObjectWrap::Unwrap<UTPSocket>(args.This());

  Local<Object> buf = args[0].As<Object>();

  self->write_buffer_.length = node::Buffer::Length(buf);
  self->write_buffer_.data = node::Buffer::Data(buf);
  write_flush(self);

  NanReturnUndefined();
}

NAN_METHOD(UTPSocket::Close) {
  NanScope();
  UTPSocket* self = node::ObjectWrap::Unwrap<UTPSocket>(args.This());
  if (self->socket_ != NULL) {
    utp_close(self->socket_);
    self->socket_ = NULL;
  }
  NanReturnUndefined();
}

static int setup (UTPSocket *self, char *localAddr, char *localPort, char *remoteAddr, char *remotePort) { // TODO: no char *localPort :/
  if (self->handle_ != NULL) return -1;

  struct addrinfo hints, *res;
  struct sockaddr_in sin;

  memset(&hints, 0, sizeof(hints));
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_DGRAM;
  hints.ai_protocol = IPPROTO_UDP;

  self->fd_ = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  self->handle_ = (uv_poll_t *) malloc(sizeof(uv_poll_t));
  self->timeouts_ = (uv_timer_t *) malloc(sizeof(uv_timer_t));

  // bind local
  if (getaddrinfo(localAddr, localPort, &hints, &res)) return -2;
  if (bind(self->fd_, res->ai_addr, res->ai_addrlen)) return -3;

  freeaddrinfo(res);
  socklen_t len = sizeof(sin);
  if (getsockname(self->fd_, (struct sockaddr *) &sin, &len) != 0) return -4;

  // printf("Bound to local %s:%d\n", inet_ntoa(sin.sin_addr), ntohs(sin.sin_port));

  self->context_ = utp_init(2);
  utp_context_set_userdata(self->context_, self);

  utp_set_callback(self->context_, UTP_LOG, &callback_log);
  utp_set_callback(self->context_, UTP_SENDTO, &callback_sendto);
  utp_set_callback(self->context_, UTP_ON_ERROR, &callback_on_error);
  utp_set_callback(self->context_, UTP_ON_STATE_CHANGE, &callback_on_state_change);
  utp_set_callback(self->context_, UTP_ON_READ, &callback_on_read);
  utp_set_callback(self->context_, UTP_ON_FIREWALL, &callback_on_firewall);
  utp_set_callback(self->context_, UTP_ON_ACCEPT, &callback_on_accept);

  if (remoteAddr != NULL) {
    self->socket_ = utp_create_socket(self->context_);
    utp_set_userdata(self->socket_, self);

    if (getaddrinfo(remoteAddr, remotePort, &hints, &res)) return -5;

    // struct sockaddr_in *sin = (struct sockaddr_in *)res->ai_addr;
    // printf("Connecting to %s:%d\n", inet_ntoa(sinp->sin_addr), ntohs(sinp->sin_port));
    utp_connect(self->socket_, res->ai_addr, res->ai_addrlen);
    freeaddrinfo(res);
  }

  self->handle_->data = self;
  uv_poll_init(uv_default_loop(), self->handle_, self->fd_);
  uv_poll_start(self->handle_, UV_READABLE, poll_worker);

  self->timeouts_->data = self;
  uv_timer_init(uv_default_loop(), self->timeouts_);
  uv_timer_start(self->timeouts_, check_timeouts, 500, 500);

  return 0;
}

NAN_METHOD(UTPSocket::Listen) {
  NanScope();
  UTPSocket* self = node::ObjectWrap::Unwrap<UTPSocket>(args.This());

  NanUtf8String port(args[0]);

  if (setup(self, (char *) "0.0.0.0", *port, NULL, NULL)) {
    return NanThrowError("socket setup failed");
  }

  NanReturnUndefined();
}

NAN_METHOD(UTPSocket::Connect) {
  NanScope();
  UTPSocket* self = node::ObjectWrap::Unwrap<UTPSocket>(args.This());

  NanUtf8String port(args[0]);
  NanUtf8String host(args[1]);

  if (setup(self, (char *) "0.0.0.0", (char *) "0", *host, *port)) {
    return NanThrowError("socket setup failed");
  }

  NanReturnUndefined();
}

}