const fs = require('fs');
const path = require('path');

const files = [
  'app/(app)/inspection.js',
  'app/(app)/incidents.js',
  'app/(app)/fuel-report.js',
  'app/(app)/(tabs)/map.js',
  'app/(app)/(tabs)/index.js',
  'app/(app)/(tabs)/history.js',
  'app/(app)/trip/[id].js',
  'app/(app)/profile/vehicle.js',
  'app/(app)/profile/safety.js',
  'app/(app)/profile/personal.js',
  'app/(app)/profile/license.js',
];

// Calculate a relative import path from the file to the component
function relativeImport(fromFile) {
  const depth = fromFile.split('/').length - 1;
  return '../'.repeat(depth) + 'components/AppAlert';
}

let changed = 0;

files.forEach(f => {
  if (!fs.existsSync(f)) { console.log('SKIP (not found):', f); return; }
  let c = fs.readFileSync(f, 'utf8');
  if (!c.includes('Alert.alert')) { console.log('SKIP (no Alert.alert):', f); return; }

  // 1. Remove Alert from react-native imports
  c = c.replace(/import\s*\{([^}]+)\}\s*from\s*['"]react-native['"]/g, (m, imports) => {
    const cleaned = imports
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== 'Alert')
      .join(', ');
    return `import { ${cleaned} } from 'react-native'`;
  });

  // 2. Add AppAlert import if not already there
  if (!c.includes('AppAlert')) {
    const rel = relativeImport(f);
    // Insert after the last import line
    c = c.replace(/((?:import[^\n]*\n)+)/, (m) => m + `import { AppAlert } from '${rel}';\n`);
  }

  // 3. Replace all Alert.alert with AppAlert.alert
  c = c.replace(/\bAlert\.alert\b/g, 'AppAlert.alert');

  fs.writeFileSync(f, c);
  changed++;
  console.log('Updated:', f);
});

console.log('Done. Changed', changed, 'files.');
