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
    constructor(id, x, y, physics, webglManager, width = 512, height = 512) {
        super(id, 'texture-buffer', x, y, physics);
        this.webglManager = webglManager;
        this.textureWidth = width;
        this.textureHeight = height;
        this.texture = webglManager.createTexture(width, height);
        this.previewCanvas = null;
        this.isDrawing = false;
        this.drawContext = null;
        
        this.inputs = [{ name: 'input', port: 0 }];
        this.outputs = [{ name: 'output', port: 0 }];
        
        this.createElement();
        this.setupDrawing();
    }

    createElement() {
        const div = super.createElement();
        
        div.innerHTML = `
            <div class="node-header">
                <span class="node-title">Texture Buffer</span>
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
        this.previewCanvas.width = 200;
        this.previewCanvas.height = 200;

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

        return div;
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
        const py = Math.max(0, Math.min(this.textureHeight - 1, Math.floor(y * this.textureHeight)));

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
        }
    }

    clear() {
        const gl = this.webglManager.gl;
        const data = new Uint8Array(this.textureWidth * this.textureHeight * 4);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.textureWidth, this.textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        this.updatePreview();
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
            this.webglManager.renderTextureToCanvas(this.texture, this.previewCanvas);
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
    }
}

class ShaderNode extends Node {
    constructor(id, x, y, physics, webglManager) {
        super(id, 'shader', x, y, physics);
        this.webglManager = webglManager;
        this.editor = null;
        this.code = '';
        this.program = null;
        this.inputTextures = [];
        this.outputTexture = null;
        this.monacoEditor = null;
        
        this.inputs = [];
        this.outputs = [];
        
        this.createElement();
        this.initMonaco();
    }

    createElement() {
        const div = super.createElement();
        
        div.innerHTML = `
            <div class="node-header">
                <span class="node-title">Shader</span>
                <span class="node-type">Shader</span>
            </div>
            <div class="shader-header-code" id="shader-header-${this.id}"></div>
            <div class="node-content shader-node">
                <div class="shader-editor-container">
                    <div class="shader-editor" id="shader-editor-${this.id}"></div>
                </div>
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

        return div;
    }

    async initMonaco() {
        if (typeof monaco === 'undefined') {
            setTimeout(() => this.initMonaco(), 100);
            return;
        }

        const editorContainer = this.element.querySelector(`#shader-editor-${this.id}`);
        if (!editorContainer) return;

        this.monacoEditor = monaco.editor.create(editorContainer, {
            value: 'vec4 output() {\n    return vec4(1.0, 0.0, 0.0, 1.0);\n}',
            language: 'glsl',
            theme: 'vs-dark',
            fontSize: 12,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true
        });

        this.monacoEditor.onDidChangeModelContent(() => {
            this.code = this.monacoEditor.getValue();
            this.updateHeader();
        });

        this.updateHeader();
    }

    updateHeader() {
        const headerEl = this.element.querySelector(`#shader-header-${this.id}`);
        if (!headerEl) return;

        const inputDeclarations = this.inputs.length > 0 
            ? this.inputs.map((_, i) => `uniform sampler2D input${i};`).join('\n') + '\n'
            : '';
        
        const headerCode = `#version 300 es
precision mediump float;
${inputDeclarations}in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    fragColor = output();
}`;

        headerEl.textContent = headerCode;
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
        this.updateHeader();
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
            const inputIndex = this.inputs.findIndex(inp => inp.port === edge.toPort);
            if (inputIndex >= 0) {
                const sourceNode = edge.from;
                let sourceTexture = null;
                
                if (sourceNode.type === 'texture-buffer') {
                    sourceTexture = sourceNode.getOutputTexture();
                } else if (sourceNode.type === 'shader') {
                    sourceTexture = sourceNode.getOutputTexture(edge.fromPort);
                }
                
                if (sourceTexture) {
                    inputTextures[`input${inputIndex}`] = sourceTexture;
                }
            }
        }

        // Get output texture from connections or create default
        const outgoingEdges = graph.getEdgesFrom(this);
        let targetTexture = null;
        let targetSize = { width: 512, height: 512 };
        
        if (outgoingEdges.length > 0) {
            const firstEdge = outgoingEdges[0];
            const targetNode = firstEdge.to;
            if (targetNode.type === 'texture-buffer') {
                targetTexture = targetNode.texture;
                targetSize = { width: targetNode.textureWidth, height: targetNode.textureHeight };
            }
        }

        // Create output texture if needed
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
                this.program = webglManager.createProgram(vertexSource, fullCode);
                this.lastCode = this.code;
            }

            webglManager.renderToTexture(targetTexture, this.program, inputTextures);
            
            // Update connected texture buffers
            for (const edge of outgoingEdges) {
                const targetNode = edge.to;
                if (targetNode.type === 'texture-buffer') {
                    targetNode.updatePreview();
                }
            }
        } catch (error) {
            console.error('Shader evaluation error:', error);
        }
    }

    getOutputTexture(port = 0) {
        return this.outputTexture;
    }

    getFullShaderCode() {
        const inputDeclarations = this.inputs.length > 0 
            ? this.inputs.map((_, i) => `uniform sampler2D input${i};`).join('\n') + '\n'
            : '';
        
        const headerCode = `#version 300 es
precision mediump float;
${inputDeclarations}in vec2 v_texCoord;
out vec4 fragColor;

`;
        const mainCode = `
void main() {
    fragColor = output();
}
`;
        return headerCode + this.code + mainCode;
    }
}

