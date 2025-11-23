class Node {
    constructor(id, type, x, y, physics) {
        this.id = id;
        this.type = type;
        this.physics = physics;
        this.particle = physics.addParticle(x, y, 1, 200, 200);
        this.element = null;
        this.selected = false;
        this.inputs = [];
        this.outputs = [];
        this.connections = [];
    }

    createElement() {
        const div = document.createElement('div');
        div.className = `node ${this.type}-node`;
        div.dataset.nodeId = this.id;
        this.element = div;
        return div;
    }

    updatePosition() {
        if (this.element && this.particle) {
            const x = this.particle.x - this.particle.width / 2;
            const y = this.particle.y - this.particle.height / 2;
            this.element.style.left = `${x}px`;
            this.element.style.top = `${y}px`;
            this.element.style.width = `${this.particle.width}px`;
            this.element.style.height = `${this.particle.height}px`;
        }
    }

    setSize(width, height) {
        if (this.particle) {
            this.physics.updateParticleSize(this.particle, width, height);
        }
    }

    destroy() {
        if (this.particle) {
            this.physics.removeParticle(this.particle);
        }
        if (this.element) {
            this.element.remove();
        }
    }
}

class TextureBufferNode extends Node {
    constructor(id, x, y, physics, webglManager, width = 512, height = 512, name = 'tex_0') {
        super(id, 'texture-buffer', x, y, physics);
        this.webglManager = webglManager;
        this.textureWidth = width;
        this.textureHeight = height;
        this.texture = webglManager.createTexture(width, height);
        this.previewCanvas = null;
        this.isDrawing = false;
        this.drawContext = null;
        this.name = name;
        
        // Set proper size for texture buffer node (needs space for header, preview, and controls)
        // Header: ~40px, Preview: 200px, Controls: ~40px, Padding: 24px = ~304px minimum
        this.setSize(200, 320);
        
        this.inputs = [{ name: 'input', port: 0 }];
        this.outputs = [{ name: 'output', port: 0 }];
        
        this.createElement();
        this.setupDrawing();
    }

    createElement() {
        const div = super.createElement();
        
        div.innerHTML = `
            <div class="node-header">
                <span class="node-title" contenteditable="true" data-node-title="${this.id}">${this.name}</span>
                <span class="node-type">Buffer</span>
            </div>
            <div class="node-content texture-buffer-node">
                <div class="texture-preview-container">
                    <canvas class="texture-preview-canvas"></canvas>
                    <div class="texture-info">${this.textureWidth}×${this.textureHeight}</div>
                </div>
                <div class="texture-controls">
                    <button class="btn" data-action="clear">Clear</button>
                    <button class="btn" data-action="resize">Resize</button>
                </div>
            </div>
        `;

        this.previewCanvas = div.querySelector('.texture-preview-canvas');
        // Set canvas size to match container (will be updated after container is rendered)
        const updateCanvasSize = () => {
            const container = this.previewCanvas.parentElement;
            if (container) {
                const rect = container.getBoundingClientRect();
                this.previewCanvas.width = rect.width;
                this.previewCanvas.height = rect.height;
            }
        };
        // Update after a short delay to ensure container is rendered
        setTimeout(updateCanvasSize, 10);
        // Also update on resize
        window.addEventListener('resize', updateCanvasSize);

        // Ports
        const inputPort = document.createElement('div');
        inputPort.className = 'port input';
        inputPort.style.top = '50%';
        inputPort.dataset.port = 'input-0';
        div.appendChild(inputPort);

        const outputPort = document.createElement('div');
        outputPort.className = 'port output';
        outputPort.style.top = '50%';
        outputPort.dataset.port = 'output-0';
        div.appendChild(outputPort);

        // Event listeners
        div.querySelector('[data-action="clear"]').addEventListener('click', () => this.clear());
        div.querySelector('[data-action="resize"]').addEventListener('click', () => this.promptResize());

        // Make title editable
        const titleEl = div.querySelector(`[data-node-title="${this.id}"]`);
        if (titleEl) {
            titleEl.addEventListener('blur', () => {
                const newName = titleEl.textContent.trim() || this.name;
                this.setName(newName);
            });
            
            titleEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    titleEl.blur();
                } else if (e.key === 'Escape') {
                    titleEl.textContent = this.name;
                    titleEl.blur();
                }
            });
        }

        return div;
    }

    setName(name) {
        // Sanitize name for GLSL identifier (remove spaces, special chars, ensure valid identifier)
        let sanitizedName = name.replace(/[^a-zA-Z0-9_]/g, '_');
        // GLSL identifiers can't start with a number
        if (/^[0-9]/.test(sanitizedName)) {
            sanitizedName = '_' + sanitizedName;
        }
        // Must have at least one character
        if (!sanitizedName || sanitizedName === '_') {
            sanitizedName = 'textureBuffer';
        }
        this.name = sanitizedName;
        
        // Update display (keep original for display, use sanitized for GLSL)
        const titleEl = this.element.querySelector(`[data-node-title="${this.id}"]`);
        if (titleEl) {
            titleEl.textContent = name;
        }
        
        // Notify connected shader nodes to update their headers
        // We'll need access to the graph, so this will be handled when shaders re-evaluate
        // For now, we'll trigger an update through the app if available
        if (window.app && window.app.graph) {
            const outgoingEdges = window.app.graph.getEdgesFrom(this);
            for (const edge of outgoingEdges) {
                if (edge.to.type === 'shader') {
                    edge.to.updateHeader(window.app.graph);
                }
            }
            window.app.saveState(); // Save after name change
        }
    }

    setupDrawing() {
        if (!this.previewCanvas) return;

        const canvas = this.previewCanvas;
        const ctx = canvas.getContext('2d');
        this.drawContext = ctx;

        canvas.addEventListener('mousedown', (e) => {
            if (this.physics.particles.some(p => Math.abs(p.vx) < 0.1 && Math.abs(p.vy) < 0.1)) {
                this.isDrawing = true;
                this.draw(e);
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (this.isDrawing) {
                this.draw(e);
            }
        });

        canvas.addEventListener('mouseup', () => {
            this.isDrawing = false;
        });

        canvas.addEventListener('mouseleave', () => {
            this.isDrawing = false;
        });
    }

    draw(e) {
        const canvas = this.previewCanvas;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        const gl = this.webglManager.gl;
        const px = Math.max(0, Math.min(this.textureWidth - 1, Math.floor(x * this.textureWidth)));
        // Flip y coordinate: canvas has (0,0) at top-left, WebGL textures have (0,0) at bottom-left
        const py = Math.max(0, Math.min(this.textureHeight - 1, this.textureHeight - 1 - Math.floor(y * this.textureHeight)));

        // Draw a small brush (3x3 pixels)
        const brushSize = 3;
        const data = new Uint8Array(brushSize * brushSize * 4);
        for (let i = 0; i < brushSize * brushSize; i++) {
            data[i * 4] = 255;
            data[i * 4 + 1] = 255;
            data[i * 4 + 2] = 255;
            data[i * 4 + 3] = 255;
        }

        const startX = Math.max(0, px - Math.floor(brushSize / 2));
        const startY = Math.max(0, py - Math.floor(brushSize / 2));
        const endX = Math.min(this.textureWidth, startX + brushSize);
        const endY = Math.min(this.textureHeight, startY + brushSize);
        const actualWidth = endX - startX;
        const actualHeight = endY - startY;

        if (actualWidth > 0 && actualHeight > 0) {
            const actualData = new Uint8Array(actualWidth * actualHeight * 4);
            for (let i = 0; i < actualWidth * actualHeight; i++) {
                actualData[i * 4] = 255;
                actualData[i * 4 + 1] = 255;
                actualData[i * 4 + 2] = 255;
                actualData[i * 4 + 3] = 255;
            }

            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, startX, startY, actualWidth, actualHeight, gl.RGBA, gl.UNSIGNED_BYTE, actualData);

            // Update preview
            this.updatePreview();
            
            // Don't save state on every draw - it's too frequent and causes quota issues
            // State will be saved periodically by the auto-save mechanism
            // Drawing operations don't need to be persisted (they're manual edits)
        }
    }

    clear() {
        const gl = this.webglManager.gl;
        const data = new Uint8Array(this.textureWidth * this.textureHeight * 4);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.textureWidth, this.textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        this.updatePreview();
        
        // Save state after clear
        if (window.app) {
            window.app.saveState();
        }
    }

    promptResize() {
        const width = prompt('Width:', this.textureWidth);
        const height = prompt('Height:', this.textureHeight);
        if (width && height) {
            this.resize(parseInt(width), parseInt(height));
        }
    }

    resize(width, height) {
        this.textureWidth = width;
        this.textureHeight = height;
        const gl = this.webglManager.gl;
        gl.deleteTexture(this.texture);
        this.texture = this.webglManager.createTexture(width, height);
        this.element.querySelector('.texture-info').textContent = `${width}×${height}`;
        this.updatePreview();
    }

    updatePreview() {
        if (this.previewCanvas) {
            this.webglManager.renderTextureToCanvas(this.texture, this.previewCanvas, this.textureWidth, this.textureHeight);
        }
    }

    getOutputTexture() {
        return this.texture;
    }

    setInputTexture(texture) {
        // Copy texture data using a shader to handle size differences
        const gl = this.webglManager.gl;
        
        // Get source texture size
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const srcWidth = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WIDTH);
        const srcHeight = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_HEIGHT);
        
        // Use a simple copy shader
        const vertexSource = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            out vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        const fragmentSource = `#version 300 es
            precision mediump float;
            in vec2 v_texCoord;
            uniform sampler2D u_texture;
            out vec4 fragColor;
            void main() {
                fragColor = texture(u_texture, v_texCoord);
            }
        `;

        let program = this.webglManager.programs.get('copy');
        if (!program) {
            program = this.webglManager.createProgram(vertexSource, fragmentSource);
            this.webglManager.programs.set('copy', program);
        }

        // Render source texture to this texture
        this.webglManager.renderToTexture(this.texture, program, { u_texture: texture });
        this.updatePreview();
        
        // Don't save state on every texture update - it's too frequent and causes quota issues
        // State will be saved periodically by the auto-save mechanism
    }
}

class ShaderNode extends Node {
    constructor(id, x, y, physics, webglManager, name = 'shad_0') {
        super(id, 'shader', x, y, physics);
        this.webglManager = webglManager;
        this.editor = null;
        this.code = '';
        this.program = null;
        this.inputTextures = [];
        this.outputTexture = null;
        this.monacoEditor = null;
        this.name = name;
        
        this.inputs = [];
        this.outputs = [];
        
        // Set larger default size for shader nodes (width: 400px, height: 500px)
        this.setSize(400, 500);
        
        this.createElement();
        // Delay Monaco initialization slightly to ensure DOM is ready
        setTimeout(() => this.initMonaco(), 50);
    }

    createElement() {
        const div = super.createElement();
        
        div.innerHTML = `
            <div class="node-header">
                <span class="node-title" contenteditable="true" data-node-title="${this.id}">${this.name}</span>
                <span class="node-type">Shader</span>
            </div>
            <div class="node-content shader-node">
                <div class="shader-header-code" id="shader-header-top-${this.id}"></div>
                <div class="shader-editor-container">
                    <div class="shader-editor" id="shader-editor-${this.id}"></div>
                </div>
                <div class="shader-header-code" id="shader-header-bottom-${this.id}"></div>
                <div class="shader-error" id="shader-error-${this.id}" style="display: none;"></div>
            </div>
        `;

        // Resize handles
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle se';
        div.appendChild(resizeHandle);

        const resizeHandleS = document.createElement('div');
        resizeHandleS.className = 'resize-handle s';
        div.appendChild(resizeHandleS);

        const resizeHandleE = document.createElement('div');
        resizeHandleE.className = 'resize-handle e';
        div.appendChild(resizeHandleE);

        // Setup resize
        this.setupResize(resizeHandle, resizeHandleS, resizeHandleE);

        // Make title editable
        const titleEl = div.querySelector(`[data-node-title="${this.id}"]`);
        if (titleEl) {
            titleEl.addEventListener('blur', () => {
                const newName = titleEl.textContent.trim() || this.name;
                this.setName(newName);
            });
            
            titleEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    titleEl.blur();
                } else if (e.key === 'Escape') {
                    titleEl.textContent = this.name;
                    titleEl.blur();
                }
            });
        }

        return div;
    }

    setName(name) {
        // Sanitize name for GLSL identifier (remove spaces, special chars, ensure valid identifier)
        let sanitizedName = name.replace(/[^a-zA-Z0-9_]/g, '_');
        // GLSL identifiers can't start with a number
        if (/^[0-9]/.test(sanitizedName)) {
            sanitizedName = '_' + sanitizedName;
        }
        // Must have at least one character
        if (!sanitizedName || sanitizedName === '_') {
            sanitizedName = 'shader';
        }
        this.name = sanitizedName;
        
        // Update display (keep original for display, use sanitized for GLSL)
        const titleEl = this.element.querySelector(`[data-node-title="${this.id}"]`);
        if (titleEl) {
            titleEl.textContent = name;
        }
    }

    async initMonaco() {
        const editorContainer = this.element.querySelector(`#shader-editor-${this.id}`);
        if (!editorContainer) {
            setTimeout(() => this.initMonaco(), 100);
            return;
        }

        // Function to actually create the editor
        const createEditor = () => {
            // Ensure container has dimensions - wait for it to be visible
            const container = editorContainer.parentElement;
            if (!container) {
                setTimeout(() => this.initMonaco(), 100);
                return;
            }
            
            // Force a layout calculation
            const rect = container.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
                setTimeout(() => this.initMonaco(), 100);
                return;
            }

            // Ensure editor container has proper dimensions
            const editorRect = editorContainer.getBoundingClientRect();
            if (editorRect.width === 0 || editorRect.height === 0) {
                setTimeout(() => this.initMonaco(), 100);
                return;
            }

            try {
                if (this.monacoEditor) {
                    // Editor already exists, don't create again
                    return;
                }

                // Register GLSL language if not already registered
                if (!monaco.languages.getLanguages().find(lang => lang.id === 'glsl')) {
                    monaco.languages.register({ id: 'glsl' });
                    
                    // Configure comment syntax for GLSL
                    monaco.languages.setLanguageConfiguration('glsl', {
                        comments: {
                            lineComment: '//',
                            blockComment: ['/*', '*/']
                        },
                        brackets: [
                            ['{', '}'],
                            ['[', ']'],
                            ['(', ')']
                        ],
                        autoClosingPairs: [
                            { open: '{', close: '}' },
                            { open: '[', close: ']' },
                            { open: '(', close: ')' },
                            { open: '"', close: '"' },
                            { open: "'", close: "'" }
                        ],
                        surroundingPairs: [
                            { open: '{', close: '}' },
                            { open: '[', close: ']' },
                            { open: '(', close: ')' },
                            { open: '"', close: '"' },
                            { open: "'", close: "'" }
                        ]
                    });
                    
                    monaco.languages.setMonarchTokensProvider('glsl', {
                        tokenizer: {
                            root: [
                                [/\/\*/, 'comment', '@comment'],
                                [/\/\/.*$/, 'comment'],
                                [/(true|false)\b/, 'keyword'],
                                [/\b(vec[234]|mat[234]|sampler2D|samplerCube|float|int|bool|void)\b/, 'type'],
                                [/\b(if|else|for|while|do|return|break|continue|discard|struct|uniform|varying|attribute|in|out|inout|const)\b/, 'keyword'],
                                [/\b(texture|texture2D|textureCube|mix|smoothstep|step|clamp|fract|floor|ceil|round|abs|sign|min|max|pow|exp|log|sqrt|inversesqrt|normalize|length|distance|dot|cross|reflect|refract|mod|sin|cos|tan|asin|acos|atan|atan2|radians|degrees)\b/, 'keyword.function'],
                                [/[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?[fFdD]?/, 'number.float'],
                                [/0[xX][0-9a-fA-F]+[Ll]?/, 'number.hex'],
                                [/[0-9]+[fFdD]/, 'number.float'],
                                [/[0-9]+/, 'number'],
                                [/[a-z_$][\w$]*/, 'identifier'],
                                [/[A-Z][\w\$]*/, 'type.identifier'],
                                [/[{}()\[\]]/, '@brackets'],
                                [/[<>](?=[^=])/, '@brackets'],
                                [/[=!+\-*/%&|^]/, 'operator'],
                                [/;/, 'delimiter'],
                                [/"/, 'string', '@string'],
                                [/'/, 'string', '@string_single']
                            ],
                            comment: [
                                [/[^/*]+/, 'comment'],
                                [/\/\*/, 'comment', '@push'],
                                [/\*\//, 'comment', '@pop'],
                                [/[/*]/, 'comment']
                            ],
                            string: [
                                [/[^\\"]+/, 'string'],
                                [/\\./, 'string.escape'],
                                [/"/, 'string', '@pop']
                            ],
                            string_single: [
                                [/[^\\']+/, 'string'],
                                [/\\./, 'string.escape'],
                                [/'/, 'string', '@pop']
                            ]
                        }
                    });
                }

                this.monacoEditor = monaco.editor.create(editorContainer, {
                    value: 'vec4 compute() {\n    return vec4(1.0, 0.0, 0.0, 1.0);\n}',
                    language: 'glsl',
                    theme: 'vs-dark',
                    fontSize: 12,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                });

                // Add comment keybindings
                this.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => {
                    const action = this.monacoEditor.getAction('editor.action.commentLine');
                    if (action) {
                        action.run();
                    }
                });
                
                this.monacoEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyA, () => {
                    const action = this.monacoEditor.getAction('editor.action.blockComment');
                    if (action) {
                        action.run();
                    }
                });

                this.code = this.monacoEditor.getValue();

                this.monacoEditor.onDidChangeModelContent(() => {
                    this.code = this.monacoEditor.getValue();
                    // Clear previous error when code changes
                    this.clearError();
                    // updateHeader will be called with graph when connections change
                    // Save state after code change (debounced)
                    if (window.app) {
                        if (this.saveCodeTimeout) {
                            clearTimeout(this.saveCodeTimeout);
                        }
                        this.saveCodeTimeout = setTimeout(() => {
                            window.app.saveState();
                            this.saveCodeTimeout = null;
                        }, 1000); // Save 1 second after typing stops
                    }
                });

                // Update header after Monaco is initialized
                if (window.app && window.app.graph) {
                    this.updateHeader(window.app.graph);
                }
            } catch (error) {
                console.error('Error creating Monaco editor:', error);
                setTimeout(() => this.initMonaco(), 200);
            }
        };

        // Check if Monaco is already available
        if (typeof monaco !== 'undefined' && monaco.editor) {
            createEditor();
        } else if (typeof require !== 'undefined') {
            // Use loader to load Monaco
            require(['vs/editor/editor.main'], () => {
                if (typeof monaco !== 'undefined' && monaco.editor) {
                    createEditor();
                } else {
                    setTimeout(() => this.initMonaco(), 200);
                }
            }, (error) => {
                console.error('Error loading Monaco:', error);
                setTimeout(() => this.initMonaco(), 200);
            });
        } else {
            // Wait for Monaco to load
            setTimeout(() => this.initMonaco(), 100);
        }
    }

    updateHeader(graph = null) {
        const headerTopEl = this.element.querySelector(`#shader-header-top-${this.id}`);
        const headerBottomEl = this.element.querySelector(`#shader-header-bottom-${this.id}`);
        
        if (!headerTopEl || !headerBottomEl) return;

        // Get texture buffer names from connections
        const inputNames = {};
        const connectedPorts = new Set();
        
        if (graph) {
            const incomingEdges = graph.getEdgesTo(this);
            for (const edge of incomingEdges) {
                const toPort = edge.toPort;
                connectedPorts.add(toPort);
                
                const sourceNode = edge.from;
                if (sourceNode.type === 'texture-buffer') {
                    inputNames[toPort] = sourceNode.name;
                } else if (sourceNode.type === 'shader') {
                    // For shader outputs, use a default name
                    inputNames[toPort] = `input${toPort}`;
                } else {
                    inputNames[toPort] = `input${toPort}`;
                }
            }
        }

        // Generate uniform declarations for all connected ports
        // Sort ports to ensure consistent ordering
        const sortedPorts = Array.from(connectedPorts).sort((a, b) => a - b);
        const inputDeclarations = sortedPorts.length > 0 
            ? sortedPorts.map(port => {
                const name = inputNames[port] || `input${port}`;
                return `uniform sampler2D ${name};`;
            }).join('\n') + '\n'
            : '';
        
        const topCode = `#version 300 es
precision mediump float;
${inputDeclarations}in vec2 v_texCoord;
out vec4 fragColor;
`;

        const bottomCode = `void main() {
    fragColor = compute();
}`;

        headerTopEl.innerHTML = this.highlightGLSL(topCode);
        headerBottomEl.innerHTML = this.highlightGLSL(bottomCode);
    }

    highlightGLSL(code) {
        // GLSL keywords
        const keywords = new Set([
            'void', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4',
            'sampler2D', 'samplerCube', 'if', 'else', 'for', 'while', 'return', 'break', 'continue',
            'discard', 'in', 'out', 'inout', 'uniform', 'attribute', 'varying', 'const', 'precision',
            'lowp', 'mediump', 'highp', 'struct', 'layout'
        ]);

        // Simple token-based highlighting
        const parts = [];
        let i = 0;
        const len = code.length;
        
        while (i < len) {
            // Check for preprocessor directive
            if (code[i] === '#' && (i === 0 || code[i - 1] === '\n')) {
                const match = code.slice(i).match(/^#(\w+)/);
                if (match) {
                    const text = match[0];
                    parts.push({ type: 'preprocessor', text });
                    i += text.length;
                    continue;
                }
            }
            
            // Check for numbers
            const numMatch = code.slice(i).match(/^\d+\.?\d*/);
            if (numMatch) {
                parts.push({ type: 'number', text: numMatch[0] });
                i += numMatch[0].length;
                continue;
            }
            
            // Check for identifiers (keywords or functions)
            const identMatch = code.slice(i).match(/^\w+/);
            if (identMatch) {
                const text = identMatch[0];
                // Check if followed by opening paren (function)
                const nextChar = code[i + text.length];
                if (nextChar === '(') {
                    if (!keywords.has(text)) {
                        parts.push({ type: 'function', text });
                        i += text.length;
                        continue;
                    }
                }
                // Check if it's a keyword
                if (keywords.has(text)) {
                    parts.push({ type: 'keyword', text });
                    i += text.length;
                    continue;
                }
                // Regular identifier
                parts.push({ type: 'text', text });
                i += text.length;
                continue;
            }
            
            // Regular character
            parts.push({ type: 'text', text: code[i] });
            i++;
        }
        
        // Build HTML with proper escaping
        let result = '';
        for (const part of parts) {
            const escaped = part.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            
            if (part.type === 'text') {
                result += escaped;
            } else {
                result += `<span class="glsl-${part.type}">${escaped}</span>`;
            }
        }
        
        return result;
    }

    setupResize(handleSE, handleS, handleE) {
        let isResizing = false;
        let startX, startY, startWidth, startHeight;
        let resizeDirection = '';

        const startResize = (e, direction) => {
            isResizing = true;
            resizeDirection = direction;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = this.particle.width;
            startHeight = this.particle.height;
            e.preventDefault();
            e.stopPropagation();
        };

        const doResize = (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            if (resizeDirection === 'se' || resizeDirection === 's') {
                const newHeight = Math.max(200, startHeight + dy);
                this.setSize(this.particle.width, newHeight);
            }
            if (resizeDirection === 'se' || resizeDirection === 'e') {
                const newWidth = Math.max(200, startWidth + dx);
                this.setSize(newWidth, this.particle.height);
            }
        };

        const stopResize = () => {
            isResizing = false;
            resizeDirection = '';
        };

        handleSE.addEventListener('mousedown', (e) => startResize(e, 'se'));
        handleS.addEventListener('mousedown', (e) => startResize(e, 's'));
        handleE.addEventListener('mousedown', (e) => startResize(e, 'e'));

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
    }

    addInput(name) {
        this.inputs.push({ name, port: this.inputs.length });
        this.updatePorts();
        // Header will be updated when connections are made
    }

    addOutput(name) {
        this.outputs.push({ name, port: this.outputs.length });
        this.updatePorts();
    }

    updatePorts() {
        // Remove old ports
        const oldPorts = this.element.querySelectorAll('.port');
        oldPorts.forEach(p => p.remove());

        // Add input ports
        this.inputs.forEach((input, i) => {
            const port = document.createElement('div');
            port.className = 'port input';
            port.style.top = `${30 + i * 30}%`;
            port.dataset.port = `input-${i}`;
            this.element.appendChild(port);
        });

        // Add output ports
        this.outputs.forEach((output, i) => {
            const port = document.createElement('div');
            port.className = 'port output';
            port.style.top = `${30 + i * 30}%`;
            port.dataset.port = `output-${i}`;
            this.element.appendChild(port);
        });
    }

    evaluate(webglManager, graph) {
        if (!this.code) return;

        // Get input textures from connections
        const inputTextures = {};
        const incomingEdges = graph.getEdgesTo(this);
        
        for (const edge of incomingEdges) {
            const sourceNode = edge.from;
            let sourceTexture = null;
            let uniformName = null;
            
            if (sourceNode.type === 'texture-buffer') {
                sourceTexture = sourceNode.getOutputTexture();
                uniformName = sourceNode.name; // Use texture buffer name
            } else if (sourceNode.type === 'shader') {
                sourceTexture = sourceNode.getOutputTexture(edge.fromPort);
                // For shader outputs, we need to find the uniform name from the header
                // The uniform name is based on the port number
                uniformName = `input${edge.toPort}`;
            }
            
            if (sourceTexture && uniformName) {
                inputTextures[uniformName] = sourceTexture;
            }
        }

        // Get output texture from connections or create default
        const outgoingEdges = graph.getEdgesFrom(this);
        let targetTexture = null;
        let targetSize = { width: 512, height: 512 };
        
        // Find the first texture buffer output, or use the first output port's target
        for (const edge of outgoingEdges) {
            const targetNode = edge.to;
            if (targetNode.type === 'texture-buffer') {
                targetTexture = targetNode.texture;
                targetSize = { width: targetNode.textureWidth, height: targetNode.textureHeight };
                break; // Use the first texture buffer we find
            }
        }

        // If no texture buffer output, create our own output texture
        if (!targetTexture) {
            if (!this.outputTexture) {
                this.outputTexture = webglManager.createTexture(targetSize.width, targetSize.height);
            }
            targetTexture = this.outputTexture;
        }

        try {
            const fullCode = this.getFullShaderCode();
            const vertexSource = `#version 300 es
                in vec2 a_position;
                in vec2 a_texCoord;
                out vec2 v_texCoord;
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    v_texCoord = a_texCoord;
                }
            `;

            // Recompile if code changed
            const codeChanged = this.lastCode !== this.code;
            if (!this.program || codeChanged) {
                if (this.program) {
                    webglManager.gl.deleteProgram(this.program);
                }
                try {
                    this.program = webglManager.createProgram(vertexSource, fullCode);
                    this.lastCode = this.code;
                    this.clearError(); // Clear error on successful compilation
                } catch (compileError) {
                    this.showError(compileError.message);
                    throw compileError; // Re-throw to prevent rendering
                }
            }

            // Render shader output to target texture
            webglManager.renderToTexture(targetTexture, this.program, inputTextures);
            
            // Update header with current connections (only if needed)
            // Don't update header during evaluation to avoid unnecessary work
        } catch (error) {
            // Error already displayed by showError if it's a compilation error
            if (!error.message.includes('Shader compilation') && !error.message.includes('Program linking')) {
                this.showError(error.message);
            }
        }
    }

    getOutputTexture(port = 0) {
        // If we have a direct connection to a texture buffer, return that texture
        // Otherwise return our internal output texture
        if (window.app && window.app.graph) {
            const outgoingEdges = window.app.graph.getEdgesFrom(this);
            for (const edge of outgoingEdges) {
                if (edge.fromPort === port) {
                    const targetNode = edge.to;
                    if (targetNode.type === 'texture-buffer') {
                        return targetNode.texture;
                    }
                }
            }
        }
        return this.outputTexture;
    }

    getFullShaderCode() {
        // Get texture buffer names from connections (same logic as updateHeader)
        const graph = window.app ? window.app.graph : null;
        const inputNames = {};
        const connectedPorts = new Set();
        
        if (graph) {
            const incomingEdges = graph.getEdgesTo(this);
            for (const edge of incomingEdges) {
                const toPort = edge.toPort;
                connectedPorts.add(toPort);
                
                const sourceNode = edge.from;
                if (sourceNode.type === 'texture-buffer') {
                    inputNames[toPort] = sourceNode.name;
                } else if (sourceNode.type === 'shader') {
                    // For shader outputs, use a default name
                    inputNames[toPort] = `input${toPort}`;
                } else {
                    inputNames[toPort] = `input${toPort}`;
                }
            }
        }

        // Generate uniform declarations for all connected ports
        // Sort ports to ensure consistent ordering
        const sortedPorts = Array.from(connectedPorts).sort((a, b) => a - b);
        const inputDeclarations = sortedPorts.length > 0 
            ? sortedPorts.map(port => {
                const name = inputNames[port] || `input${port}`;
                return `uniform sampler2D ${name};`;
            }).join('\n') + '\n'
            : '';
        
        const headerCode = `#version 300 es
precision mediump float;
${inputDeclarations}in vec2 v_texCoord;
out vec4 fragColor;

`;
        const mainCode = `
void main() {
    fragColor = compute();
}
`;
        return headerCode + this.code + mainCode;
    }

    showError(errorMessage) {
        const errorEl = this.element.querySelector(`#shader-error-${this.id}`);
        if (errorEl) {
            errorEl.textContent = errorMessage;
            errorEl.style.display = 'block';
        }
    }

    clearError() {
        const errorEl = this.element.querySelector(`#shader-error-${this.id}`);
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
    }
}

