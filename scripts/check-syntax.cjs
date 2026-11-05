for(const file of ['assets/schedule-board.js'])new (require('node:vm').Script)(require('node:fs').readFileSync(file,'utf8'),{filename:file});
const fs = require('node:fs');
const vm = require('node:vm');
for (const file of [...fs.readdirSync('gas').filter(f=>f.endsWith('.gs')).map(f=>'gas/'+f),...fs.readdirSync('test').filter(f=>/^gas-native-.*\.gs$/.test(f)).map(f=>'test/'+f)]) {
  new vm.Script(fs.readFileSync(file,'utf8'), {filename:file});
}
console.log('GAS and native verification helper: syntax OK');
