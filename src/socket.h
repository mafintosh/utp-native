#ifndef UTP_SOCKET_H
#define UTP_SOCKET_H

#include <nan.h>
#include <uv.h>
#include "../deps/libutp/utp.h"

using namespace v8;

namespace utp_native {

NAN_METHOD(Build);

class UTPSocket : public node::ObjectWrap {
  public:
    static void Init ();
    static Handle<Value> NewInstance ();

    utp_socket *socket_;
    int fd_;
    unsigned char *buffer_;
    utp_context *context_;
    uv_poll_t *handle_;

    NanCallback *on_connect;
    NanCallback *on_read;
    NanCallback *on_eof;
    NanCallback *on_destroying;
    NanCallback *on_socket;

    UTPSocket ();
    ~UTPSocket ();
  private:
    static Persistent<FunctionTemplate> utp_socket_constructor;
    static NAN_METHOD(New);
    static NAN_METHOD(Connect);
    static NAN_METHOD(Listen);
    static NAN_METHOD(Handlers);
    static NAN_METHOD(Write);
};

}

#endif