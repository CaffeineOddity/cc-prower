const { Command } = require('commander');
const program = new Command();

program
  .command('run')
  .argument('<path>')
  .option('-s, --session <name>')
  .allowUnknownOption(true)
  .action((path, options, command) => {
    console.log('Path:', path);
    console.log('Options:', options);
    console.log('Command args:', command.args);
    const claudeArgs = command.args.slice(1);
    console.log('Claude Args:', claudeArgs);
  });

program.parse(process.argv);
