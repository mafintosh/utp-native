#ifndef UTP_SOCKET_H
#define UTP_SOCKET_H

#include <nan.h>
#include <uv.h>
#include "../deps/libutp/utp.h"

using namespace v8;

namespace utp_native {

NAN_METHOD(Build);

typedef struct {
  char* data;
  size_t length;
} utp_write_buffer_t;

class UTPSocket : public node::ObjectWrap {
  public:
    static void Init ();
    static Handle<Value> NewInstance ();

    int fd_;
    utp_socket *socket_;
    utp_context *context_;
    uv_poll_t *handle_;
    uv_timer_t *timeouts_; // TODO: have one global instead

    unsigned char *read_buffer_;

    NanCallback *on_connect;
    NanCallback *on_read;
    NanCallback *on_eof;
    NanCallback *on_destroying;
    NanCallback *on_socket;
    NanCallback *on_drain;

    utp_write_buffer_t write_buffer_;

    UTPSocket ();
    ~UTPSocket ();
  private:
    static Persistent<FunctionTemplate> utp_socket_constructor;
    static NAN_METHOD(New);
    static NAN_METHOD(Connect);
    static NAN_METHOD(Listen);
    static NAN_METHOD(Handlers);
    static NAN_METHOD(Write);
    static NAN_METHOD(Writev);
    static NAN_METHOD(Close);
};

}

#endif