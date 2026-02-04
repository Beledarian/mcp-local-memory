import * as fs from 'fs';
import * as path from 'path';
import type { Database } from 'better-sqlite3';

/**
 * Extension Loader - Dynamically loads custom tools from external directories
 * 
 * This allows keeping private/experimental tools separate from the public codebase.
 * 
 * Usage:
 *   Set EXTENSIONS_PATH env var to a directory containing extension modules.
 *   Each module should export: { handler: Function, tool: ToolDefinition }
 */

export interface Extension {
    handler: (db: Database, args?: any) => any;
    tool: {
        name: string;
        description: string;
        inputSchema: any;
    };
}

export function loadExtensions(extensionsPath?: string): Extension[] {
    if (!extensionsPath) {
        return [];
    }

    if (!fs.existsSync(extensionsPath)) {
        console.error(`[Extensions] Path not found: ${extensionsPath}`);
        return [];
    }

    const extensions: Extension[] = [];
    
    try {
        const files = fs.readdirSync(extensionsPath).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
        
        for (const file of files) {
            try {
                const modulePath = path.join(extensionsPath, file);
                const module = require(modulePath);
                
                // Expected format: export function handleToolName() and export const TOOL_NAME_TOOL
                // Or: export default { handler, tool }
                
                if (module.default && module.default.handler && module.default.tool) {
                    extensions.push(module.default);
                    console.log(`[Extensions] Loaded: ${module.default.tool.name}`);
                } else {
                    // Auto-detect handler and tool definition
                    const handlerKey = Object.keys(module).find(k => k.startsWith('handle'));
                    const toolKey = Object.keys(module).find(k => k.endsWith('_TOOL') || k.endsWith('Tool'));
                    
                    if (handlerKey && toolKey) {
                        extensions.push({
                            handler: module[handlerKey],
                            tool: module[toolKey]
                        });
                        console.log(`[Extensions] Loaded: ${module[toolKey].name}`);
                    }
                }
            } catch (err: any) {
                console.warn(`[Extensions] Failed to load ${file}:`, err.message);
            }
        }
    } catch (err: any) {
        console.error(`[Extensions] Error reading directory:`, err.message);
    }

    return extensions;
}
