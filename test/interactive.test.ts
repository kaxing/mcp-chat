import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClient } from '../src/interactive';
import readline from 'readline/promises';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';

// Mock readline and other dependencies as needed
vi.mock('readline/promises', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn(),
    close: vi.fn(),
    history: [],
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio', () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const originalFs = await importOriginal();
  return {
    ...originalFs,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined), // Mock mkdir to resolve successfully
    readdir: vi.fn().mockResolvedValue([]), // Mock readdir to return empty array
  };
});


describe('MCPClient', () => {
  let client: MCPClient;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    client = new MCPClient({});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('handleSpecialCommand', () => {
    it('should handle "history 0" and log error for non-positive N', async () => {
      const result = await client['handleSpecialCommand']('history 0');
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('Error: N must be a positive integer for history command.');
    });

    it('should handle "history -5" and log error for non-positive N', async () => {
      const result = await client['handleSpecialCommand']('history -5');
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('Error: N must be a positive integer for history command.');
    });

    it('should handle "history abc" and log usage message', async () => {
      const result = await client['handleSpecialCommand']('history abc');
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('Usage: history [N] or history -n N');
    });
    
    it('should handle "history -n abc" and log usage message', async () => {
      const result = await client['handleSpecialCommand']('history -n abc');
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('Usage: history [N] or history -n N');
    });

    it('should handle valid "history" (default N) and display command history', async () => {
      client['commandHistory'] = ['cmd1', 'cmd2'];
      const result = await client['handleSpecialCommand']('history');
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('1  cmd1');
      expect(consoleLogSpy).toHaveBeenCalledWith('2  cmd2');
    });

    it('should handle valid "history 5" and display command history', async () => {
      client['commandHistory'] = ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6'];
      const result = await client['handleSpecialCommand']('history 5');
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('2  cmd2'); // Should show last 5
      expect(consoleLogSpy).toHaveBeenCalledWith('6  cmd6');
      expect(consoleLogSpy).not.toHaveBeenCalledWith('1  cmd1');
    });
    
    it('should handle valid "history -n 5" and display command history', async () => {
      client['commandHistory'] = ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6'];
      const result = await client['handleSpecialCommand']('history -n 5');
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('2  cmd2'); // Should show last 5
      expect(consoleLogSpy).toHaveBeenCalledWith('6  cmd6');
      expect(consoleLogSpy).not.toHaveBeenCalledWith('1  cmd1');
    });

    it('should handle "quit" command', async () => {
      const result = await client['handleSpecialCommand']('quit');
      expect(result).toBe(true);
    });

    it('should handle "exit" command', async () => {
      const result = await client['handleSpecialCommand']('exit');
      expect(result).toBe(true);
    });

    it('should return false for non-special commands', async () => {
      const result = await client['handleSpecialCommand']('some other command');
      expect(result).toBe(false);
    });
  });

  describe('connectToServer', () => {
    let mcpClient: MCPClient;
    let consoleErrorSpyConnect: any;
    let mockTransportInstance: any;

    beforeEach(() => {
      // Reset options to avoid interference between tests
      mcpClient = new MCPClient({}); 
      consoleErrorSpyConnect = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {}); // Suppress warnings during tests

      // Mock the transport instance and its close method
      mockTransportInstance = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      // Mock the StdioClientTransport constructor to return our mock instance
      (StdioClientTransport as any).mockImplementation(() => mockTransportInstance);
      
      // Mock mcp.connect and mcp.listTools
      mcpClient['mcp'].connect = vi.fn();
      mcpClient['mcp'].listTools = vi.fn().mockResolvedValue({ tools: [] });
    });

    afterEach(() => {
      consoleErrorSpyConnect.mockRestore();
      vi.restoreAllMocks(); // This will also restore console.warn
    });

    it('should log "script path not found" for ENOENT error and clean up', async () => {
      const serverPath = 'nonexistent.js';
      const enoentError = new Error('ENOENT error') as any;
      enoentError.code = 'ENOENT';
      (StdioClientTransport as any).mockImplementation(() => { throw enoentError; });

      await expect(mcpClient.connectToServer(serverPath)).rejects.toThrow(enoentError);
      
      expect(consoleErrorSpyConnect).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to connect to MCP server "${serverPath}".`)
      );
      expect(consoleErrorSpyConnect).toHaveBeenCalledWith(
        expect.stringContaining(`Error: The script path was not found.`)
      );
      expect(mcpClient['transport']).toBeNull();
    });

    it('should log "permission denied" for EACCES error and clean up', async () => {
      const serverPath = 'denied.js';
      const eaccesError = new Error('EACCES: permission denied') as any;
      eaccesError.code = 'EACCES'; // Some systems might set this
      (StdioClientTransport as any).mockImplementation(() => { throw eaccesError; });
      
      // Assign a dummy transport to check if it's closed and nulled
      const dummyTransport = { close: vi.fn().mockResolvedValue(undefined) };
      mcpClient['transport'] = dummyTransport as any;


      await expect(mcpClient.connectToServer(serverPath)).rejects.toThrow(eaccesError);
      
      expect(consoleErrorSpyConnect).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to connect to MCP server "${serverPath}".`)
      );
      expect(consoleErrorSpyConnect).toHaveBeenCalledWith(
        expect.stringContaining(`Error: Permission denied.`)
      );
      expect(dummyTransport.close).toHaveBeenCalled();
      expect(mcpClient['transport']).toBeNull();
    });
    
    it('should log generic error message for other errors and clean up', async () => {
      const serverPath = 'error.js';
      const genericError = new Error('Some other error');
      (StdioClientTransport as any).mockImplementation(() => { throw genericError; });

      // Assign a dummy transport
      const dummyTransport = { close: vi.fn().mockResolvedValue(undefined) };
      mcpClient['transport'] = dummyTransport as any;

      await expect(mcpClient.connectToServer(serverPath)).rejects.toThrow(genericError);

      expect(consoleErrorSpyConnect).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to connect to MCP server "${serverPath}".`)
      );
      expect(consoleErrorSpyConnect).toHaveBeenCalledWith(
        expect.stringContaining(`Details: ${genericError.message}`)
      );
      expect(dummyTransport.close).toHaveBeenCalled();
      expect(mcpClient['transport']).toBeNull();
    });

    it('should clean up existing transport if connectToServer is called again', async () => {
      const firstServerPath = 'server1.js';
      const secondServerPath = 'server2.js';

      // First connection (successful)
      await mcpClient.connectToServer(firstServerPath);
      const firstTransportInstance = mcpClient['transport']; // Keep a reference
      expect(firstTransportInstance).not.toBeNull();
      if(firstTransportInstance) { // type guard
        expect((firstTransportInstance as any).close).not.toHaveBeenCalled();
      }


      // Mock listTools for the second call
      mcpClient['mcp'].listTools = vi.fn().mockResolvedValue({ tools: [{name: 'toolB', description: 'descB', inputSchema: {}}] });
      
      // Second connection (successful)
      await mcpClient.connectToServer(secondServerPath);
      const secondTransportInstance = mcpClient['transport'];
      
      expect(secondTransportInstance).not.toBeNull();
      expect(secondTransportInstance).not.toBe(firstTransportInstance); // New transport instance

      // Assert that the close method of the first transport was called
      expect((firstTransportInstance as any).close).toHaveBeenCalled();
    });

    it('should handle Python server paths correctly', async () => {
      const serverPath = 'script.py my-arg';
      await mcpClient.connectToServer(serverPath);
      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
        command: process.platform === "win32" ? "python" : "python3",
        args: ['my-arg'],
      }));
    });
    
    it('should handle "uv python" server paths correctly', async () => {
      const serverPath = 'uv python script.py my-arg';
      await mcpClient.connectToServer(serverPath);
      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
        command: 'uv',
        args: ['python', 'script.py', 'my-arg'],
      }));
    });

    it('should handle JS server paths with "node" correctly', async () => {
      const serverPath = 'node script.js my-arg';
      await mcpClient.connectToServer(serverPath);
      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
        command: 'node',
        args: ['script.js', 'my-arg'],
      }));
    });
    
    it('should handle JS server paths with "bun" correctly', async () => {
      const serverPath = 'bun script.js my-arg';
      await mcpClient.connectToServer(serverPath);
      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
        command: 'bun',
        args: ['script.js', 'my-arg'],
      }));
    });
    
    it('should handle npx server paths correctly', async () => {
      const serverPath = 'npx some-package --arg';
      await mcpClient.connectToServer(serverPath);
      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
        command: 'npx',
        args: ['some-package', '--arg'],
      }));
    });
    
    it('should handle uvx server paths correctly', async () => {
      const serverPath = 'uvx some-package --arg';
      await mcpClient.connectToServer(serverPath);
      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
        command: 'uvx',
        args: ['some-package', '--arg'],
      }));
    });

    it('should handle docker server paths correctly', async () => {
        const serverPath = 'docker run my-image --param';
        await mcpClient.connectToServer(serverPath);
        expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({
          command: 'docker',
          args: ['run', 'my-image', '--param'],
        }));
      });
  });

  describe('chatLoop', () => {
    let mcpClient: MCPClient;
    let mockReadlineInterface: any;

    beforeEach(() => {
      mcpClient = new MCPClient({});
      
      // Mock methods that are called within chatLoop
      vi.spyOn(mcpClient, 'loadHistory').mockResolvedValue(undefined);
      vi.spyOn(mcpClient, 'loadChatFile').mockResolvedValue(undefined);
      vi.spyOn(mcpClient, 'handleSpecialCommand').mockResolvedValue(false); // Assume not a special command
      vi.spyOn(mcpClient, 'processQueryStream').mockResolvedValue(undefined);
      vi.spyOn(mcpClient, 'saveChatFile').mockResolvedValue(undefined);
      
      mockReadlineInterface = {
        question: vi.fn(),
        close: vi.fn(),
        history: [], // Mock history for readline
      };
      (readline.createInterface as any).mockReturnValue(mockReadlineInterface);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should call saveHistory before processQueryStream for non-empty, non-special command', async () => {
      const testMessage = 'hello world';
      mockReadlineInterface.question.mockResolvedValueOnce(testMessage).mockResolvedValueOnce('exit'); // First valid message, then exit

      const saveHistorySpy = vi.spyOn(mcpClient, 'saveHistory').mockResolvedValue(undefined);
      const processQueryStreamSpy = vi.spyOn(mcpClient, 'processQueryStream');

      await mcpClient.chatLoop();

      // Check that saveHistory was called with the message
      expect(saveHistorySpy).toHaveBeenCalled();
      
      // Check that processQueryStream was called after saveHistory
      // This is an indirect way to test the await, by ensuring the call order
      const saveHistoryOrder = saveHistorySpy.mock.invocationCallOrder[0];
      const processQueryStreamOrder = processQueryStreamSpy.mock.invocationCallOrder[0];
      
      expect(saveHistoryOrder).toBeLessThan(processQueryStreamOrder);
      expect(processQueryStreamSpy).toHaveBeenCalledWith(testMessage, expect.any(Function));
      expect(mcpClient['rl']).toBeNull(); // Check readline is closed
    });
    
    it('should not call saveHistory for an empty message', async () => {
      mockReadlineInterface.question.mockResolvedValueOnce('').mockResolvedValueOnce('exit');

      const saveHistorySpy = vi.spyOn(mcpClient, 'saveHistory');
      
      await mcpClient.chatLoop();

      expect(saveHistorySpy).not.toHaveBeenCalled();
      expect(mcpClient['rl']).toBeNull();
    });

    it('should exit loop when "exit" is entered', async () => {
      mockReadlineInterface.question.mockResolvedValueOnce('exit');
      // Ensure handleSpecialCommand returns true for "exit"
      vi.spyOn(mcpClient, 'handleSpecialCommand').mockImplementation(async (message: string) => {
        return message.trim().toLowerCase() === 'exit';
      });

      await mcpClient.chatLoop();

      expect(mockReadlineInterface.question).toHaveBeenCalledTimes(1);
      expect(mcpClient['rl']).toBeNull(); // Check readline is closed
    });
    
    it('should load chat file if options.chatFile is provided', async () => {
      const chatFilePath = 'test-chat.json';
      mcpClient = new MCPClient({ chatFile: chatFilePath });
      
      // Re-spy on methods for the new client instance
      const loadHistorySpy = vi.spyOn(mcpClient, 'loadHistory').mockResolvedValue(undefined);
      const loadChatFileSpy = vi.spyOn(mcpClient, 'loadChatFile').mockResolvedValue(undefined);
      vi.spyOn(mcpClient, 'handleSpecialCommand').mockResolvedValue(true); // To exit loop quickly

      mockReadlineInterface.question.mockResolvedValueOnce('exit');
      (readline.createInterface as any).mockReturnValue(mockReadlineInterface);


      await mcpClient.chatLoop();

      expect(loadHistorySpy).toHaveBeenCalled();
      expect(loadChatFileSpy).toHaveBeenCalledWith(chatFilePath);
      expect(mcpClient['rl']).toBeNull();
    });
  });
});
