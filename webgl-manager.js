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

        // Create a temporary framebuffer to render to
        const tempFBO = gl.createFramebuffer();
        const tempTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tempTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tempTexture, 0);
        
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.bindVertexArray(this.quadVAO);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        
        // Read pixels and draw to 2D canvas
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteTexture(tempTexture);
        gl.deleteFramebuffer(tempFBO);
        
        // Draw to 2D canvas
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        // Flip vertically (WebGL has origin at bottom-left, canvas at top-left)
        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * width * 4;
            const dstRow = y * width * 4;
            for (let x = 0; x < width * 4; x++) {
                imageData.data[dstRow + x] = pixels[srcRow + x];
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    getTextureSize(texture) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const width = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_WIDTH);
        const height = gl.getTexParameter(gl.TEXTURE_2D, gl.TEXTURE_HEIGHT);
        return { width, height };
    }
}

