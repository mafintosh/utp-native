#include "utp_wrap.h"
#include "socket_wrap.h"

static Nan::Persistent<FunctionTemplate> utp_constructor;

static void
callback_on_message (utp_uv_t *self, char *data, size_t len, int port, char *ip) {
  Nan::HandleScope scope;
  UTPWrap *wrap = (UTPWrap *) self->data;
  if (!wrap->on_message) return;

  Local<Object> rinfo = Nan::New<Object>();

  Nan::Set(rinfo, Nan::New<String>("address").ToLocalChecked(), Nan::New<String>(ip).ToLocalChecked());
  Nan::Set(rinfo, Nan::New<String>("family").ToLocalChecked(), Nan::New<String>("IPv4").ToLocalChecked());
  Nan::Set(rinfo, Nan::New<String>("port").ToLocalChecked(), Nan::New<Number>(port));
  Nan::Set(rinfo, Nan::New<String>("size").ToLocalChecked(), Nan::New<Number>(len));

  Local<Value> argv[] = {
    Nan::CopyBuffer((const char *) data, len).ToLocalChecked(),
    rinfo
  };

  wrap->on_message->Call(2, argv);
}

static void
callback_on_close (utp_uv_t *self) {
  Nan::HandleScope scope;
  UTPWrap *wrap = (UTPWrap *) self->data;
  if (wrap->on_close) wrap->on_close->Call(0, NULL);
}

static void
callback_on_error (utp_uv_t *self) {
  Nan::HandleScope scope;
  UTPWrap *wrap = (UTPWrap *) self->data;
  if (wrap->on_error) wrap->on_error->Call(0, NULL);
}

static void
callback_on_socket_read (utp_uv_t *self, utp_socket *socket, char *data, size_t len) {
  Nan::HandleScope scope;
  SocketWrap *wrap = (SocketWrap *) utp_uv_socket_get_userdata(socket);
  if (!wrap->on_data) return;

  Local<Value> argv[] = {
    Nan::CopyBuffer((const char *) data, len).ToLocalChecked()
  };
  wrap->on_data->Call(1, argv);
}

static void
callback_on_socket_end (utp_uv_t *self, utp_socket *socket) {
  Nan::HandleScope scope;
  SocketWrap *wrap = (SocketWrap *) utp_uv_socket_get_userdata(socket);
  if (!wrap->on_end) return;

  wrap->on_end->Call(0, NULL);
}

static void
callback_on_socket_writable (utp_uv_t *self, utp_socket *socket) {
  Nan::HandleScope scope;
  SocketWrap *wrap = (SocketWrap *) utp_uv_socket_get_userdata(socket);
  wrap->Drain();
}

static void
callback_on_socket_error (utp_uv_t *self, utp_socket *socket, int error) {
  Nan::HandleScope scope;
  SocketWrap *wrap = (SocketWrap *) utp_uv_socket_get_userdata(socket);
  if (!wrap->on_error) return;

  Local<Value> argv[] = {
    Nan::New<Number>(error)
  };

  wrap->on_error->Call(1, argv);
}

static void
callback_on_socket_close (utp_uv_t *self, utp_socket *socket) {
  Nan::HandleScope scope;
  SocketWrap *wrap = (SocketWrap *) utp_uv_socket_get_userdata(socket);
  if (!wrap->on_close) return;

  wrap->on_close->Call(0, NULL);
}

static void
callback_on_socket_connect (utp_uv_t *self, utp_socket *socket) {
  Nan::HandleScope scope;
  SocketWrap *wrap = (SocketWrap *) utp_uv_socket_get_userdata(socket);
  wrap->Drain();

  if (!wrap->on_connect) return;
  wrap->on_connect->Call(0, NULL);
}

static void
callback_on_socket (utp_uv_t *self, utp_socket *socket) {
  Nan::HandleScope scope;
  UTPWrap *wrap = (UTPWrap *) self->data;
  if (!wrap->on_socket) return;

  Local<Value> socket_wrap = SocketWrap::NewInstance();
  Local<Value> argv[] = {
    socket_wrap
  };

  SocketWrap *socket_unwrap = Nan::ObjectWrap::Unwrap<SocketWrap>(socket_wrap->ToObject());
  socket_unwrap->handle = self;
  socket_unwrap->socket = socket;
  utp_uv_socket_set_userdata(socket, socket_unwrap);

  wrap->on_socket->Call(1, argv);
}

UTPWrap::UTPWrap () {
  int ret;
  ret = utp_uv_init(&handle);
  if (ret) {
    Nan::ThrowError("Could not create handle");
    return;
  }

  handle.data = this;
  handle.firewalled = 1;

  on_message = NULL;
  on_close = NULL;
  on_error = NULL;
  on_socket = NULL;

  handle.on_message = callback_on_message;
  handle.on_close = callback_on_close;
  handle.on_error = callback_on_error;
  handle.on_socket = callback_on_socket;
  handle.on_socket_connect = callback_on_socket_connect;
  handle.on_socket_read = callback_on_socket_read;
  handle.on_socket_end = callback_on_socket_end;
  handle.on_socket_close = callback_on_socket_close;
  handle.on_socket_writable = callback_on_socket_writable;
  handle.on_socket_error = callback_on_socket_error;
}

UTPWrap::~UTPWrap () {
  if (on_message) delete on_message;
  if (on_close) delete on_close;
  if (on_error) delete on_error;
  if (on_socket) delete on_socket;
}

NAN_METHOD(UTPWrap::New) {
  UTPWrap* obj = new UTPWrap();
  obj->Wrap(info.This());
  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(UTPWrap::Bind) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  int ret;

  int port = info[0]->Uint32Value();
  Nan::Utf8String ip(info[1]);

  ret = utp_uv_bind(handle, port, *ip);
  if (ret) {
    Nan::ThrowError("Could not bind");
    return;
  }
}

NAN_METHOD(UTPWrap::Address) {
  Nan::EscapableHandleScope scope;

  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  int ret;

  Local<Object> result = Nan::New<Object>();

  char ip[17];
  int port;

  ret = utp_uv_address(handle, &port, (char *) &ip);
  if (ret) {
    Nan::ThrowError("Could not get address");
    return;
  }

  Nan::Set(result, Nan::New<String>("address").ToLocalChecked(), Nan::New<String>(ip).ToLocalChecked());
  Nan::Set(result, Nan::New<String>("port").ToLocalChecked(), Nan::New<Number>(port));

  info.GetReturnValue().Set(scope.Escape(result));
}

NAN_METHOD(UTPWrap::Send) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);

  Local<Object> buffer = info[0]->ToObject();
  int offset = info[1]->Uint32Value();
  int len = info[2]->Uint32Value();
  int port = info[3]->Uint32Value();
  Nan::Utf8String ip(info[4]);

  int sent = utp_uv_send(handle, node::Buffer::Data(buffer) + offset, len, port, *ip);
  info.GetReturnValue().Set(Nan::New<Number>(sent));
}

NAN_METHOD(UTPWrap::Destroy) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  utp_uv_destroy(handle);
}

NAN_METHOD(UTPWrap::Connect) {
  Nan::EscapableHandleScope scope;

  int port = info[0]->Uint32Value();
  Nan::Utf8String ip(info[1]);

  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  utp_socket *socket = utp_uv_connect(handle, port, *ip);

  Local<Value> socket_wrap = SocketWrap::NewInstance();
  SocketWrap *socket_unwrap = Nan::ObjectWrap::Unwrap<SocketWrap>(socket_wrap->ToObject());
  socket_unwrap->handle = handle;
  socket_unwrap->socket = socket;
  utp_uv_socket_set_userdata(socket, socket_unwrap);

  info.GetReturnValue().Set(scope.Escape(socket_wrap));
}

NAN_METHOD(UTPWrap::Debug) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  utp_uv_debug(handle);
}

NAN_METHOD(UTPWrap::Ref) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  utp_uv_ref(handle);
}

NAN_METHOD(UTPWrap::Unref) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  utp_uv_unref(handle);
}

NAN_METHOD(UTPWrap::OnMessage) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  self->on_message = new Nan::Callback(info[0].As<Function>());
}

NAN_METHOD(UTPWrap::OnClose) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  self->on_close = new Nan::Callback(info[0].As<Function>());
}

NAN_METHOD(UTPWrap::OnError) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  self->on_error = new Nan::Callback(info[0].As<Function>());
}

NAN_METHOD(UTPWrap::OnSocket) {
  UTPWrap *self = Nan::ObjectWrap::Unwrap<UTPWrap>(info.This());
  utp_uv_t *handle = &(self->handle);
  handle->firewalled = 0;
  self->on_socket = new Nan::Callback(info[0].As<Function>());
}

void UTPWrap::Init () {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(UTPWrap::New);
  utp_constructor.Reset(tpl);
  tpl->SetClassName(Nan::New("UTPWrap").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetPrototypeMethod(tpl, "bind", UTPWrap::Bind);
  Nan::SetPrototypeMethod(tpl, "send", UTPWrap::Send);
  Nan::SetPrototypeMethod(tpl, "address", UTPWrap::Address);
  Nan::SetPrototypeMethod(tpl, "ref", UTPWrap::Ref);
  Nan::SetPrototypeMethod(tpl, "unref", UTPWrap::Unref);
  Nan::SetPrototypeMethod(tpl, "destroy", UTPWrap::Destroy);
  Nan::SetPrototypeMethod(tpl, "connect", UTPWrap::Connect);
  Nan::SetPrototypeMethod(tpl, "debug", UTPWrap::Debug);
  Nan::SetPrototypeMethod(tpl, "onmessage", UTPWrap::OnMessage);
  Nan::SetPrototypeMethod(tpl, "onclose", UTPWrap::OnClose);
  Nan::SetPrototypeMethod(tpl, "onerror", UTPWrap::OnError);
  Nan::SetPrototypeMethod(tpl, "onsocket", UTPWrap::OnSocket);
}

Local<Value> UTPWrap::NewInstance () {
  Nan::EscapableHandleScope scope;

  Local<Object> instance;

  Local<FunctionTemplate> constructorHandle = Nan::New<FunctionTemplate>(utp_constructor);
  instance = constructorHandle->GetFunction()->NewInstance(0, NULL);

  return scope.Escape(instance);
}
