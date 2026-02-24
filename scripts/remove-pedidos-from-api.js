const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'api', 'index.js');
let content = fs.readFileSync(file, 'utf8');
const start = content.indexOf('// PEDIDOS (HTML) - Admin CRUD');
let blockEnd = content.indexOf('});\n\n// ===========================\n// ARTÍCULOS (HTML)');
if (blockEnd < 0) blockEnd = content.indexOf('});\r\n\r\n// ===========================\r\n// ARTÍCULOS (HTML)');
if (blockEnd >= 0) blockEnd += 3;
const endPos = blockEnd;
if (start < 0 || endPos < 0) {
  console.error('Markers not found', { start, endPos });
  process.exit(1);
}
const before = content.substring(0, start - 1).replace(/\n+$/, '');
const after = blockEnd >= 0 ? content.substring(blockEnd) : '';
const newContent = before + '\n' + after;
fs.writeFileSync(file, newContent);
console.log('Removed pedidos block');
