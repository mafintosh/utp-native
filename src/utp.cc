#include <nan.h>
#include "socket.h"

using namespace v8;

namespace utp_native {

void Init(Handle<Object> exports) {
  UTPSocket::Init();
  exports->Set(NanNew("socket"), NanNew<FunctionTemplate>(Build)->GetFunction());
}

NODE_MODULE(utp, Init)

}