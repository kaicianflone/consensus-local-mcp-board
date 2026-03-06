import { describe, it, expect } from 'vitest';
import { createServer } from '../src/server.js';
import fs from 'node:fs';
import path from 'node:path';

describe('MCP CLI', () => {
  describe('createServer', () => {
    it('should create a server instance', () => {
      const server = createServer();
      expect(server).toBeDefined();
    });
  });

  describe('bin/cli.js', () => {
    it('should exist and be executable', () => {
      const cliPath = path.resolve('bin/cli.js');
      expect(fs.existsSync(cliPath)).toBe(true);
      const stats = fs.statSync(cliPath);
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });

    it('should have correct shebang', () => {
      const cliPath = path.resolve('bin/cli.js');
      const content = fs.readFileSync(cliPath, 'utf-8');
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
    });

    it('should fork server/dist/index.js and mcp/server.js', () => {
      const cliPath = path.resolve('bin/cli.js');
      const content = fs.readFileSync(cliPath, 'utf-8');
      expect(content).toContain("'server', 'dist', 'index.js'");
      expect(content).toContain("'server', 'dist', 'mcp', 'server.js'");
    });
  });

  describe('package.json configuration', () => {
    it('should define the bin entry point in bin/cli.js', () => {
      const cliPath = path.resolve('bin/cli.js');
      expect(fs.existsSync(cliPath)).toBe(true);
    });

    it('should have build and test scripts', () => {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      expect(pkg.scripts.build).toBeDefined();
      expect(pkg.scripts.test).toBeDefined();
    });
  });
});
