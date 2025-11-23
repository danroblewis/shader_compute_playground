class WebGLManager {
    constructor() {
        this.gl = null;
        this.textures = new Map();
        this.textureDimensions = new Map(); // Store texture dimensions
        this.framebuffers = new Map();
        this.programs = new Map();
        this.quadBuffer = null;
        this.quadVAO = null;
    }

    init(canvas) {
        const gl = canvas.getContext('webgl2');
        if (!gl) {
            throw new Error('WebGL 2 not supported');
        }
        this.gl = gl;

        // Create quad for rendering
        const quadVertices = new Float32Array([
            -1, -1,  0, 0,
             1, -1,  1, 0,
            -1,  1,  0, 1,
             1,  1,  1, 1,
        ]);

        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

        // Create VAO
        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
        gl.bindVertexArray(null);

        gl.clearColor(0, 0, 0, 1);
    }

    createTexture(width, height, data = null) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        if (data) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        // Store texture dimensions
        this.textureDimensions.set(texture, { width, height });
        
        return texture;
    }

    createFramebuffer(texture) {
        const gl = this.gl;
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return framebuffer;
    }

    compileShader(source, type) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compilation error: ${error}`);
        }
        
        return shader;
    }

    createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;
        const vertexShader = this.compileShader(vertexSource, gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(fragmentSource, gl.FRAGMENT_SHADER);
        
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Program linking error: ${error}`);
        }
        
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        
        return program;
    }

    renderToTexture(texture, program, inputTextures = {}, uniforms = {}) {
        const gl = this.gl;
        
        // Get texture dimensions from our stored map
        const dims = this.textureDimensions.get(texture) || { width: 512, height: 512 };
        const texWidth = dims.width;
        const texHeight = dims.height;

        // Create framebuffer if needed
        let framebuffer = this.framebuffers.get(texture);
        if (!framebuffer) {
            framebuffer = this.createFramebuffer(texture);
            this.framebuffers.set(texture, framebuffer);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.viewport(0, 0, texWidth, texHeight);
        
        gl.useProgram(program);
        gl.bindVertexArray(this.quadVAO);

        // Bind input textures
        let textureUnit = 0;
        for (const [name, inputTexture] of Object.entries(inputTextures)) {
            const location = gl.getUniformLocation(program, name);
            if (location !== null) {
                gl.activeTexture(gl.TEXTURE0 + textureUnit);
                gl.bindTexture(gl.TEXTURE_2D, inputTexture);
                gl.uniform1i(location, textureUnit);
                textureUnit++;
            }
        }

        // Set uniforms
        for (const [name, value] of Object.entries(uniforms)) {
            const location = gl.getUniformLocation(program, name);
            if (location !== null) {
                if (typeof value === 'number') {
                    gl.uniform1f(location, value);
                } else if (value.length === 2) {
                    gl.uniform2f(location, value[0], value[1]);
                } else if (value.length === 3) {
                    gl.uniform3f(location, value[0], value[1], value[2]);
                } else if (value.length === 4) {
                    gl.uniform4f(location, value[0], value[1], value[2], value[3]);
                }
            }
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindVertexArray(null);
    }

    renderTextureToCanvas(texture, canvas, texWidth = 512, texHeight = 512, scale = 1.0) {
        const gl = this.gl;
        const width = canvas.width;
        const height = canvas.height;

        // Use a simple passthrough shader
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

        let program = this.programs.get('preview');
        if (!program) {
            program = this.createProgram(vertexSource, fragmentSource);
            this.programs.set('preview', program);
        }

        // Get or create WebGL context for this canvas
        let canvasGL = canvas._webglContext;
        if (!canvasGL) {
            canvasGL = canvas.getContext('webgl2');
            if (!canvasGL) {
                console.error('WebGL2 not supported for preview canvas');
                return;
            }
            canvas._webglContext = canvasGL;
            
            // Set up quad geometry for this context
            const quadBuffer = canvasGL.createBuffer();
            canvasGL.bindBuffer(canvasGL.ARRAY_BUFFER, quadBuffer);
            const quadData = new Float32Array([
                -1, -1,  0, 0,
                 1, -1,  1, 0,
                -1,  1,  0, 1,
                 1,  1,  1, 1
            ]);
            canvasGL.bufferData(canvasGL.ARRAY_BUFFER, quadData, canvasGL.STATIC_DRAW);
            canvas._quadBuffer = quadBuffer;
            
            // Create shader program for this context
            const vs = canvasGL.createShader(canvasGL.VERTEX_SHADER);
            canvasGL.shaderSource(vs, vertexSource);
            canvasGL.compileShader(vs);
            if (!canvasGL.getShaderParameter(vs, canvasGL.COMPILE_STATUS)) {
                console.error('Vertex shader compile error:', canvasGL.getShaderInfoLog(vs));
                return;
            }

            const fs = canvasGL.createShader(canvasGL.FRAGMENT_SHADER);
            canvasGL.shaderSource(fs, fragmentSource);
            canvasGL.compileShader(fs);
            if (!canvasGL.getShaderParameter(fs, canvasGL.COMPILE_STATUS)) {
                console.error('Fragment shader compile error:', canvasGL.getShaderInfoLog(fs));
                return;
            }

            const previewProgram = canvasGL.createProgram();
            canvasGL.attachShader(previewProgram, vs);
            canvasGL.attachShader(previewProgram, fs);
            canvasGL.linkProgram(previewProgram);
            if (!canvasGL.getProgramParameter(previewProgram, canvasGL.LINK_STATUS)) {
                console.error('Program link error:', canvasGL.getProgramInfoLog(previewProgram));
                return;
            }
            canvas._previewProgram = previewProgram;
        }

        // Save main context state
        const prevFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevViewport = gl.getParameter(gl.VIEWPORT);
        const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        const prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
        const prevTexture0 = gl.getParameter(gl.TEXTURE_BINDING_2D);

        // Use a render target (framebuffer) to render texture to the exact preview size
        // Create or reuse persistent render target for this canvas
        if (!canvas._renderTargetFBO) {
            canvas._renderTargetFBO = gl.createFramebuffer();
            canvas._renderTargetTexture = gl.createTexture();
            canvas._renderTargetWidth = 0;
            canvas._renderTargetHeight = 0;
        }
        
        const renderTargetFBO = canvas._renderTargetFBO;
        const renderTargetTexture = canvas._renderTargetTexture;
        
        // Resize render target if canvas size changed
        if (canvas._renderTargetWidth !== width || canvas._renderTargetHeight !== height) {
            gl.bindTexture(gl.TEXTURE_2D, renderTargetTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            canvas._renderTargetWidth = width;
            canvas._renderTargetHeight = height;
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        
        // Render texture to render target
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderTargetFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTargetTexture, 0);
        
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.bindVertexArray(this.quadVAO);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        // Use nearest-neighbor filtering for pixelated rendering
        const currentMinFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER);
        const currentMagFilter = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        
        gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // Restore texture filter
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, currentMinFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, currentMagFilter);
        
        // Read from render target (still need readPixels for cross-context copy, but more efficient)
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        
        // Restore main context state
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFramebuffer);
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
        gl.useProgram(prevProgram);
        gl.bindVertexArray(prevVAO);
        gl.activeTexture(prevActiveTexture);
        gl.bindTexture(gl.TEXTURE_2D, prevTexture0);
        
        // Upload to preview canvas context and render
        if (!canvas._previewTexture) {
            canvas._previewTexture = canvasGL.createTexture();
        }
        canvasGL.bindTexture(canvasGL.TEXTURE_2D, canvas._previewTexture);
        canvasGL.texImage2D(canvasGL.TEXTURE_2D, 0, canvasGL.RGBA, width, height, 0, canvasGL.RGBA, canvasGL.UNSIGNED_BYTE, pixels);
        canvasGL.texParameteri(canvasGL.TEXTURE_2D, canvasGL.TEXTURE_MIN_FILTER, canvasGL.NEAREST);
        canvasGL.texParameteri(canvasGL.TEXTURE_2D, canvasGL.TEXTURE_MAG_FILTER, canvasGL.NEAREST);
        
        // Render to preview canvas
        canvasGL.bindFramebuffer(canvasGL.FRAMEBUFFER, null);
        canvasGL.viewport(0, 0, width, height);
        canvasGL.useProgram(canvas._previewProgram);
        
        const posLoc = canvasGL.getAttribLocation(canvas._previewProgram, 'a_position');
        const texLoc = canvasGL.getAttribLocation(canvas._previewProgram, 'a_texCoord');
        
        canvasGL.bindBuffer(canvasGL.ARRAY_BUFFER, canvas._quadBuffer);
        canvasGL.enableVertexAttribArray(posLoc);
        canvasGL.vertexAttribPointer(posLoc, 2, canvasGL.FLOAT, false, 16, 0);
        canvasGL.enableVertexAttribArray(texLoc);
        canvasGL.vertexAttribPointer(texLoc, 2, canvasGL.FLOAT, false, 16, 8);
        
        canvasGL.activeTexture(canvasGL.TEXTURE0);
        canvasGL.bindTexture(canvasGL.TEXTURE_2D, canvas._previewTexture);
        canvasGL.uniform1i(canvasGL.getUniformLocation(canvas._previewProgram, 'u_texture'), 0);
        
        canvasGL.drawArrays(canvasGL.TRIANGLE_STRIP, 0, 4);
    }

    getTextureSize(texture) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const width = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WIDTH);
        const height = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_HEIGHT);
        return { width, height };
    }
}

