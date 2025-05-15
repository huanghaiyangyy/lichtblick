const fs = require('fs');
const path = require('path');
const protobufjs = require('protobufjs');

// Directory containing proto files
const PROTO_DIR = path.join(__dirname, '../msgdef');
// Output file path
const OUTPUT_PATH = path.join(__dirname, '../dist/proto_json_schemas.ts');

async function convertProtosToJsonSchema() {
  // Load all proto files in the directory
  const protoFiles = fs.readdirSync(PROTO_DIR)
    .filter(file => file.endsWith('.proto'))
    .map(file => path.join(PROTO_DIR, file));

  // Create a new protobuf root and load all proto files
  const root = new protobufjs.Root();
  await Promise.all(protoFiles.map(file => root.load(file, { keepCase: true })));

  // Convert the loaded protos to JSON format
  const jsonRoot = root.toJSON();

  // Generate TypeScript file content
  const tsContent = `// Auto-generated from protobuf definitions
export const ProtoJsonSchemas = ${JSON.stringify(jsonRoot, null, 2)};

// Export individual proto namespaces for convenience
${Object.keys(jsonRoot.nested || {})
  .map(namespace => `export const ${namespace}Schema = ProtoJsonSchemas.nested.${namespace};`)
  .join('\n')}

// Default export for backward compatibility
export default ProtoJsonSchemas;
`;

  // Write to output file
  fs.writeFileSync(OUTPUT_PATH, tsContent);
  console.log(`Generated JSON schema at ${OUTPUT_PATH}`);
}

convertProtosToJsonSchema().catch(err => {
  console.error('Error converting proto files:', err);
  process.exit(1);
});
