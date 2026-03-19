#!/usr/bin/env node
import { Command } from 'commander';
import {
  StartCommand,
  StopCommand,
  InitCommand,
  ValidateCommand,
  RunCommand,
  LogsCommand,
  StatusCommand,
  SetupHooksCommand,
  UninstallCommand,
} from './commands/index.js';

const CLI_NAME = 'ccpower';
const CLI_VERSION = '1.0.0';

const program = new Command();

program
  .name(CLI_NAME)
  .description('Lightweight bridge between Claude Code and chat platforms')
  .version(CLI_VERSION);

// 注册所有命令
const commands = [
  new StartCommand(program),
  new StopCommand(program),
  new InitCommand(program),
  new ValidateCommand(program),
  new RunCommand(program),
  new LogsCommand(program),
  new StatusCommand(program),
  new SetupHooksCommand(program),
  new UninstallCommand(program),
];

for (const command of commands) {
  command.register();
}

program.parse();