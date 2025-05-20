const fs = require('fs');
const path = require('path');
let ProtoJsonSchemas;

// Get the absolute path to the TypeScript schema file
const tsSchemaPath = path.resolve(__dirname, '../dist/proto_json_schemas.ts');

// Debug information
console.log(`Current directory: ${__dirname}`);
console.log(`Looking for schema at: ${tsSchemaPath}`);

// Check if the TypeScript file exists
if (!fs.existsSync(tsSchemaPath)) {
  console.error(`TypeScript schema file not found at: ${tsSchemaPath}`);
  console.error("Make sure to run the generate-proto-schemas script first!");
  process.exit(1);
}

try {
  // Read the TypeScript file content
  const fileContent = fs.readFileSync(tsSchemaPath, 'utf8');

  // Extract the JSON schema using regex
  // This looks for the line that starts with "export const ProtoJsonSchemas ="
  const schemaMatch = fileContent.match(/export\s+const\s+ProtoJsonSchemas\s*=\s*(\{[\s\S]*?\}\s*;)/m);

  if (!schemaMatch || !schemaMatch[1]) {
    console.error("Failed to extract schema from TypeScript file");
    process.exit(1);
  }

  // Get the JSON string and remove the trailing semicolon if present
  let jsonString = schemaMatch[1].replace(/;$/, '');

  // Parse the JSON string to get the actual object
  try {
    ProtoJsonSchemas = eval(`(${jsonString})`); // Using eval since JSON.parse won't work with complex objects
    console.log("Successfully extracted schema from TypeScript file");
  } catch (parseError) {
    console.error("Failed to parse JSON schema:", parseError);
    process.exit(1);
  }

} catch (error) {
  console.error(`Failed to read TypeScript schema file: ${error.message}`);
  process.exit(1);
}

// Function to convert field type to the correct format
function getCorrectType(type) {
  // Map protobuf types to MessageDefinition types
  const typeMapping = {
    "double": "float64",
    "float": "float32",
    "int32": "int32",
    "uint32": "uint32",
    "int64": "int64",
    "uint64": "uint64",
    "bool": "bool",
    "string": "string",
    "bytes": "uint8"
  };

  return typeMapping[type] || type;
}

// Function to convert ProtoJsonSchemas to MessageDefinitions
function convertSchemasToDefinitions() {
  const definitions = [];

  function processNamespace(namespace, prefix = "") {
    if (!namespace.nested) return;

    for (const [name, value] of Object.entries(namespace.nested)) {
      const currentPrefix = prefix ? `${prefix}.${name}` : name;

      // Process nested namespaces recursively
      if (value.nested) {
        processNamespace(value, currentPrefix);
      }

      // Process message definitions
      if (value.fields) {
        const fieldDefs = [];

        for (const [fieldName, fieldInfo] of Object.entries(value.fields)) {
          const fieldType = getCorrectType(fieldInfo.type);
          const isArray = fieldInfo.rule === "repeated";

          // Check if type is complex (references another message)
          const isComplex = !["float64", "float32", "int32", "uint32", "int64",
                              "uint64", "bool", "string", "uint8"].includes(fieldType);

          fieldDefs.push({
            type: fieldType,
            name: fieldName,
            isArray,
            isComplex
          });
        }

        definitions.push([
          currentPrefix,
          {
            name: currentPrefix,
            definitions: fieldDefs
          }
        ]);
      }
    }
  }

  // Start processing from the root
  processNamespace(ProtoJsonSchemas);

  return definitions;
}

// Generate definitions
const protoDefinitions = convertSchemasToDefinitions();

// Create the TS file content
const outputContent = `// Auto-generated from ProtoJsonSchemas
export const ProtoMessages = ${JSON.stringify(protoDefinitions, null, 2)};

export const PublishProtoDataTypes = new Map(
  ProtoMessages.map(([type, def]) => [type, def]),
);

// Export default for backward compatibility
export default PublishProtoDataTypes;
`;

// Write to proto_definitions.ts
const outputPath = path.join(__dirname, "../dist/proto_definitions.ts");
fs.writeFileSync(outputPath, outputContent);
console.log(`Generated protocol definitions at ${outputPath}`);
