#!/usr/bin/env node

import { select, input, confirm, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import Table from 'cli-table3';
import { execSync, spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PackageManager {
  constructor() {
    this.mode = null;
    this.projectPath = null;
    this.packages = [];
  }

  runCommand(command, options = {}) {
    try {
      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
      });
      
      if (result.error) {
        throw result.error;
      }
      
      return {
        success: result.status === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        status: result.status
      };
    } catch (error) {
      return {
        success: false,
        stdout: '',
        stderr: error.message,
        status: -1
      };
    }
  }

  getGlobalPackages() {
    console.log(chalk.blue('正在获取全局 npm 包...'));
    const npmResult = this.runCommand('npm list -g --depth=0 --json');
    const npmPackages = npmResult.success ? this.parseNpmListOutput(npmResult.stdout, 'npm') : [];

    console.log(chalk.blue('正在获取全局 pnpm 包...'));
    const pnpmResult = this.runCommand('pnpm list -g --depth=0 --json');
    const pnpmPackages = pnpmResult.success ? this.parseNpmListOutput(pnpmResult.stdout, 'pnpm') : [];

    return [...npmPackages, ...pnpmPackages];
  }

  getLocalPackages(projectPath) {
    const packageJsonPath = join(projectPath, 'package.json');
    if (!existsSync(packageJsonPath)) {
      console.log(chalk.red('错误：在指定路径中未找到 package.json 文件'));
      return [];
    }

    console.log(chalk.blue('正在获取本地项目包...'));
    
    const manager = this.detectPackageManager(projectPath);
    const result = this.runCommand(`${manager} list --depth=0 --json`, { cwd: projectPath });
    
    if (result.success) {
      return this.parseNpmListOutput(result.stdout, manager);
    } else {
      console.log(chalk.yellow(`使用 ${manager} 命令失败，尝试使用 npm...`));
      const npmResult = this.runCommand('npm list --depth=0 --json', { cwd: projectPath });
      return npmResult.success ? this.parseNpmListOutput(npmResult.stdout, 'npm') : [];
    }
  }

  detectPackageManager(projectPath) {
    const pnpmLock = join(projectPath, 'pnpm-lock.yaml');
    const packageLock = join(projectPath, 'package-lock.json');
    
    if (existsSync(pnpmLock)) {
      return 'pnpm';
    } else if (existsSync(packageLock)) {
      return 'npm';
    }
    
    return 'npm';
  }

  parseNpmListOutput(jsonOutput, manager) {
    const packages = [];
    try {
      const data = JSON.parse(jsonOutput);
      if (data.dependencies) {
        for (const [name, info] of Object.entries(data.dependencies)) {
          packages.push({
            name,
            version: info.version || 'unknown',
            manager
          });
        }
      }
    } catch (error) {
      console.log(chalk.yellow(`解析 ${manager} 包列表时出错: ${error.message}`));
    }
    return packages;
  }

  displayPackages() {
    if (this.packages.length === 0) {
      console.log(chalk.yellow('当前环境中没有找到任何包'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('#'),
        chalk.cyan('包名'),
        chalk.cyan('版本'),
        chalk.cyan('管理器')
      ],
      colWidths: [5, 30, 15, 10],
      style: {
        head: [],
        border: ['gray']
      }
    });

    this.packages.forEach((pkg, index) => {
      table.push([
        index + 1,
        pkg.name,
        pkg.version,
        pkg.manager === 'pnpm' ? chalk.magenta('pnpm') : chalk.green('npm')
      ]);
    });

    console.log('\n' + table.toString());
    console.log(chalk.blue(`共 ${this.packages.length} 个包\n`));
  }

  async selectMode() {
    const mode = await select({
      message: '请选择管理模式:',
      choices: [
        {
          name: '管理系统全局包',
          value: 'global',
          description: '管理全局安装的 npm 和 pnpm 包'
        },
        {
          name: '管理本地项目',
          value: 'local',
          description: '管理指定项目路径中的依赖包'
        },
        {
          name: '退出',
          value: 'exit',
          description: '退出程序'
        }
      ]
    });

    this.mode = mode;

    if (mode === 'local') {
      await this.selectProjectPath();
    }

    return mode;
  }

  async selectProjectPath() {
    const validatePath = (path) => {
      if (!path || path.trim() === '') {
        return '请输入有效的路径';
      }
      
      const trimmedPath = path.trim();
      if (!existsSync(trimmedPath)) {
        return '路径不存在，请检查后重新输入';
      }
      
      try {
        const stats = statSync(trimmedPath);
        if (!stats.isDirectory()) {
          return '路径必须是一个目录';
        }
        
        const packageJsonPath = join(trimmedPath, 'package.json');
        if (!existsSync(packageJsonPath)) {
          return '目录中未找到 package.json 文件，请确保这是一个有效的 Node.js 项目';
        }
        
        return true;
      } catch (error) {
        return `路径检查失败: ${error.message}`;
      }
    };

    const path = await input({
      message: '请输入项目路径:',
      validate: validatePath
    });

    this.projectPath = path.trim();
    console.log(chalk.green(`已选择项目路径: ${this.projectPath}`));
  }

  loadPackages() {
    if (this.mode === 'global') {
      this.packages = this.getGlobalPackages();
    } else if (this.mode === 'local' && this.projectPath) {
      this.packages = this.getLocalPackages(this.projectPath);
    }
    
    this.displayPackages();
  }

  async refreshPackages() {
    console.log(chalk.blue('\n正在刷新包列表...'));
    this.loadPackages();
    console.log(chalk.green('刷新完成\n'));
  }

  async batchUninstall() {
    if (this.packages.length === 0) {
      console.log(chalk.yellow('没有可卸载的包'));
      return;
    }

    const choices = this.packages.map((pkg, index) => ({
      name: `${pkg.name}@${pkg.version} (${pkg.manager})`,
      value: index
    }));

    const selected = await checkbox({
      message: '请选择要卸载的包 (按空格键选择，按 Enter 确认):',
      choices,
      pageSize: 10
    });

    if (selected.length === 0) {
      console.log(chalk.yellow('未选择任何包'));
      return;
    }

    const packagesToUninstall = selected.map(index => this.packages[index]);
    
    console.log(chalk.yellow('\n您将卸载以下包:'));
    packagesToUninstall.forEach(pkg => {
      console.log(chalk.yellow(`  - ${pkg.name}@${pkg.version} (${pkg.manager})`));
    });

    const confirmed = await confirm({
      message: `确定要卸载这 ${packagesToUninstall.length} 个包吗?`,
      default: false
    });

    if (!confirmed) {
      console.log(chalk.gray('已取消操作'));
      return;
    }

    const npmPackages = packagesToUninstall.filter(pkg => pkg.manager === 'npm');
    const pnpmPackages = packagesToUninstall.filter(pkg => pkg.manager === 'pnpm');

    if (npmPackages.length > 0) {
      const npmNames = npmPackages.map(pkg => pkg.name).join(' ');
      const command = this.mode === 'global' 
        ? `npm uninstall -g ${npmNames}`
        : `npm uninstall ${npmNames}`;
      
      console.log(chalk.blue(`\n正在执行: ${command}`));
      const result = this.runCommand(command, { 
        cwd: this.mode === 'local' ? this.projectPath : process.cwd() 
      });
      
      if (result.success) {
        console.log(chalk.green(`成功卸载 ${npmPackages.length} 个 npm 包`));
      } else {
        console.log(chalk.red(`卸载 npm 包失败: ${result.stderr}`));
      }
    }

    if (pnpmPackages.length > 0) {
      const pnpmNames = pnpmPackages.map(pkg => pkg.name).join(' ');
      const command = this.mode === 'global' 
        ? `pnpm uninstall -g ${pnpmNames}`
        : `pnpm uninstall ${pnpmNames}`;
      
      console.log(chalk.blue(`\n正在执行: ${command}`));
      const result = this.runCommand(command, { 
        cwd: this.mode === 'local' ? this.projectPath : process.cwd() 
      });
      
      if (result.success) {
        console.log(chalk.green(`成功卸载 ${pnpmPackages.length} 个 pnpm 包`));
      } else {
        console.log(chalk.red(`卸载 pnpm 包失败: ${result.stderr}`));
      }
    }

    await this.refreshPackages();
  }

  async clearCache() {
    console.log(chalk.yellow('\n缓存清理操作将删除 npm 和 pnpm 的缓存文件'));
    
    const confirmed = await confirm({
      message: '确定要清理包管理器缓存吗?',
      default: false
    });

    if (!confirmed) {
      console.log(chalk.gray('已取消操作'));
      return;
    }

    console.log(chalk.blue('\n正在清理 npm 缓存...'));
    const npmResult = this.runCommand('npm cache clean --force');
    if (npmResult.success) {
      console.log(chalk.green('npm 缓存清理成功'));
    } else {
      console.log(chalk.yellow(`npm 缓存清理结果: ${npmResult.stderr}`));
    }

    console.log(chalk.blue('\n正在清理 pnpm 缓存...'));
    const pnpmResult = this.runCommand('pnpm store prune');
    if (pnpmResult.success) {
      console.log(chalk.green('pnpm 缓存清理成功'));
    } else {
      console.log(chalk.yellow(`pnpm 缓存清理结果: ${pnpmResult.stderr}`));
    }
  }

  async destroyDependencies() {
    if (this.mode !== 'local') {
      console.log(chalk.red('此操作仅在本地项目模式下可用'));
      return;
    }

    console.log(chalk.red('\n⚠️  危险操作: 这将删除项目的 node_modules 目录和所有依赖'));
    console.log(chalk.yellow('此操作不可恢复，请确保您知道自己在做什么'));
    
    const confirmed = await confirm({
      message: '确定要删除项目的所有依赖吗?',
      default: false
    });

    if (!confirmed) {
      console.log(chalk.gray('已取消操作'));
      return;
    }

    const manager = this.detectPackageManager(this.projectPath);
    
    console.log(chalk.blue(`\n正在删除 node_modules 目录...`));
    
    const nodeModulesPath = join(this.projectPath, 'node_modules');
    if (existsSync(nodeModulesPath)) {
      try {
        if (process.platform === 'win32') {
          const result = this.runCommand(`rmdir /s /q "${nodeModulesPath}"`);
          if (!result.success) {
            console.log(chalk.red(`删除 node_modules 失败: ${result.stderr}`));
          }
        } else {
          const result = this.runCommand(`rm -rf "${nodeModulesPath}"`);
          if (!result.success) {
            console.log(chalk.red(`删除 node_modules 失败: ${result.stderr}`));
          }
        }
        console.log(chalk.green('node_modules 目录已删除'));
      } catch (error) {
        console.log(chalk.red(`删除 node_modules 失败: ${error.message}`));
      }
    } else {
      console.log(chalk.yellow('node_modules 目录不存在'));
    }

    console.log(chalk.blue('\n依赖已销毁。您可以运行以下命令重新安装依赖:'));
    console.log(chalk.cyan(`  cd ${this.projectPath}`));
    console.log(chalk.cyan(`  ${manager} install`));
  }

  async showMenu() {
    const menuChoices = [
      {
        name: '🔄 刷新列表',
        value: 'refresh',
        description: '重新加载当前环境的包列表'
      },
      {
        name: '🗑️  批量卸载',
        value: 'uninstall',
        description: '选择并卸载多个包'
      }
    ];

    if (this.mode === 'global') {
      menuChoices.push({
        name: '🧹 清理缓存',
        value: 'cache',
        description: '清理 npm 和 pnpm 的缓存'
      });
    } else if (this.mode === 'local') {
      menuChoices.push({
        name: '💥 销毁依赖',
        value: 'destroy',
        description: '删除项目的 node_modules 目录'
      });
    }

    menuChoices.push(
      {
        name: '🔙 返回模式选择',
        value: 'back',
        description: '返回上一级菜单'
      },
      {
        name: '❌ 退出',
        value: 'exit',
        description: '退出程序'
      }
    );

    const action = await select({
      message: '请选择操作:',
      choices: menuChoices
    });

    return action;
  }

  async run() {
    console.log(chalk.green.bold('\n========================================'));
    console.log(chalk.green.bold('  npm/pnpm 包管理器 TUI 工具'));
    console.log(chalk.green.bold('========================================\n'));

    try {
      while (true) {
        const mode = await this.selectMode();
        
        if (mode === 'exit') {
          console.log(chalk.blue('\n感谢使用，再见！'));
          break;
        }

        this.loadPackages();

        while (true) {
          const action = await this.showMenu();
          
          switch (action) {
            case 'refresh':
              await this.refreshPackages();
              break;
            case 'uninstall':
              await this.batchUninstall();
              break;
            case 'cache':
              await this.clearCache();
              break;
            case 'destroy':
              await this.destroyDependencies();
              break;
            case 'back':
              break;
            case 'exit':
              console.log(chalk.blue('\n感谢使用，再见！'));
              return;
          }
          
          if (action === 'back') {
            break;
          }
        }
      }
    } catch (error) {
      if (error.message.includes('User force closed')) {
        console.log(chalk.blue('\n程序已退出'));
      } else {
        console.log(chalk.red(`\n发生错误: ${error.message}`));
        console.log(chalk.red(error.stack));
      }
    }
  }
}

// 启动应用
const manager = new PackageManager();
manager.run();
