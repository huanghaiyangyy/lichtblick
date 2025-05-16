import * as protobufjs from "protobufjs";

export function serializeProtobufMessage(message: any, schemaName: string, schemas: any): Uint8Array {
  // 在线转换的方式，用 protobufjs 把 JS对象 （json）编码为 protobuf 格式
  const root = protobufjs.Root.fromJSON(schemas);
  const type = root.lookupType(schemaName);
  const protoMessage = type.create(message);
  return type.encode(protoMessage).finish(); // Returns Uint8Array
}
