#include <nan.h>
#include "utp_uv.h"

using namespace v8;

class UTPWrap : public Nan::ObjectWrap {
public:
  Nan::Callback *on_message;
  Nan::Callback *on_close;
  Nan::Callback *on_error;
  Nan::Callback *on_socket;

  static void Init ();
  static Local<Value> NewInstance ();
  UTPWrap ();
  ~UTPWrap ();

private:
  utp_uv_t handle;

  static NAN_METHOD(New);
  static NAN_METHOD(Bind);
  static NAN_METHOD(Send);
  static NAN_METHOD(Address);
  static NAN_METHOD(Destroy);
  static NAN_METHOD(Debug);
  static NAN_METHOD(Ref);
  static NAN_METHOD(Unref);
  static NAN_METHOD(Connect);
  static NAN_METHOD(OnMessage);
  static NAN_METHOD(OnClose);
  static NAN_METHOD(OnError);
  static NAN_METHOD(OnSocket);
};
