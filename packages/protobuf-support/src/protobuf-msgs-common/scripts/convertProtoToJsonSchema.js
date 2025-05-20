const fs = require('fs');
const path = require('path');
const protobufjs = require('protobufjs');

// Directory containing proto files
const PROTO_DIR = path.join(__dirname, '../msgdef');
// Output file path
const OUTPUT_DIR = path.join(__dirname, '../dist');
const OUTPUT_PATH = path.join(__dirname, '../dist/proto_json_schemas.ts');

// Check if output directory exists, if not create it
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Function to recursively find all .proto files in a directory and its subdirectories
function findProtoFiles(dir) {
  let results = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory()) {
      // Recursively search subdirectories
      results = results.concat(findProtoFiles(itemPath));
    } else if (item.endsWith('.proto')) {
      // Add proto files to results
      results.push(itemPath);
    }
  }

  return results;
}

async function convertProtosToJsonSchema() {
  // Recursively find all .proto files
  const protoFiles = findProtoFiles(PROTO_DIR);

  console.log(`Found ${protoFiles.length} .proto files`);

  // Create a new protobuf root with include paths configured
  const root = new protobufjs.Root();

  // Add the proto directory to include paths to handle imports properly
  root.resolvePath = (origin, target) => {

    // If target is already absolute, return it directly
    if (path.isAbsolute(target)) {
      return target;
    }

    // If origin is a file, get its directory
    const directory = origin ? path.dirname(origin) : PROTO_DIR;

    // Try direct resolution first
    const resolved = path.resolve(directory, target);
    if (fs.existsSync(resolved)) {
      return resolved;
    }

    // Try resolving from the base proto directory
    const fromRoot = path.resolve(PROTO_DIR, target);
    if (fs.existsSync(fromRoot)) {
      return fromRoot;
    }

    // Handle foxglove namespace special case
    if (target.startsWith('foxglove/')) {
      const foxglovePath = path.resolve(PROTO_DIR, 'foxglove_proto', target.replace('foxglove/', ''));
      if (fs.existsSync(foxglovePath)) {
        return foxglovePath;
      }
    }

    console.warn(`Warning: Could not resolve import ${target}`);
    return target;
  };

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
