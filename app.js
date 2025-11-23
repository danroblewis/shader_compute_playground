class App {
    constructor() {
        this.canvas = document.getElementById('main-canvas');
        this.nodeContainer = document.getElementById('node-container');
        this.physics = new PhysicsEngine();
        this.webglManager = new WebGLManager();
        this.graph = new Graph();
        
        this.nodes = [];
        this.selectedNode = null;
        this.connectingFrom = null;
        this.connectingFromPort = null;
        this.dragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.connectionLine = null;
        
        this.nodeIdCounter = 0;
        this.textureBufferCounter = 0;
        this.shaderCounter = 0;
        this.iteration = 0;
        
        this.init();
    }

    init() {
        // Setup canvas
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Initialize WebGL
        this.webglManager.init(this.canvas);
        
        // Load saved state now that WebGL is ready
        this.loadState();
        
        // Setup connection line SVG
        this.setupConnectionLine();
        
        // Event listeners
        this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Global mouse events for dragging (so dragging works even outside canvas)
        document.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        
        // Stop dragging if mouse leaves window
        window.addEventListener('mouseleave', (e) => {
            if (this.dragging) {
                this.dragging = false;
                if (this.selectedNode) {
                    this.selectedNode.particle.vx = 0;
                    this.selectedNode.particle.vy = 0;
                }
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        
        // Physics and render loop
        this.animate();
        
        // Graph evaluation loop
        this.evaluateGraph();
        
        // Set up auto-save
        this.setupAutoSave();
    }

    setupAutoSave() {
        // Save state periodically and on changes
        setInterval(() => this.saveState(), 2000);
        
        // Also save on beforeunload
        window.addEventListener('beforeunload', () => this.saveState());
    }

    saveState() {
        try {
            const state = {
                nodes: this.nodes.map(node => {
                    const nodeData = {
                        id: node.id,
                        type: node.type,
                        x: node.particle.x,
                        y: node.particle.y,
                        width: node.particle.width,
                        height: node.particle.height,
                        name: node.name
                    };
                    
                    if (node.type === 'texture-buffer') {
                        nodeData.textureWidth = node.textureWidth;
                        nodeData.textureHeight = node.textureHeight;
                        // Save texture data as base64
                        const gl = this.webglManager.gl;
                        const tempFBO = gl.createFramebuffer();
                        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO);
                        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, node.texture, 0);
                        const pixels = new Uint8Array(node.textureWidth * node.textureHeight * 4);
                        gl.readPixels(0, 0, node.textureWidth, node.textureHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                        gl.deleteFramebuffer(tempFBO);
                        nodeData.textureData = Array.from(pixels);
                    } else if (node.type === 'shader') {
                        nodeData.code = node.code || (node.monacoEditor ? node.monacoEditor.getValue() : '');
                        nodeData.inputs = node.inputs.map(inp => ({ name: inp.name, port: inp.port }));
                        nodeData.outputs = node.outputs.map(out => ({ name: out.name, port: out.port }));
                    }
                    
                    return nodeData;
                }),
                edges: this.graph.edges.map(edge => ({
                    fromId: edge.from.id,
                    fromPort: edge.fromPort,
                    toId: edge.to.id,
                    toPort: edge.toPort
                })),
                counters: {
                    nodeId: this.nodeIdCounter,
                    textureBuffer: this.textureBufferCounter,
                    shader: this.shaderCounter
                }
            };
            
            localStorage.setItem('shaderPlaygroundState', JSON.stringify(state));
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }

    loadState() {
        try {
            const saved = localStorage.getItem('shaderPlaygroundState');
            if (!saved) return;
            
            const state = JSON.parse(saved);
            
            // Restore counters
            this.nodeIdCounter = state.counters?.nodeId || 0;
            this.textureBufferCounter = state.counters?.textureBuffer || 0;
            this.shaderCounter = state.counters?.shader || 0;
            
            // Create a map to store nodes by ID for connection restoration
            const nodeMap = new Map();
            
            // Restore nodes
            if (state.nodes) {
                for (const nodeData of state.nodes) {
                    let node;
                    
                    if (nodeData.type === 'texture-buffer') {
                        node = new TextureBufferNode(
                            nodeData.id,
                            nodeData.x,
                            nodeData.y,
                            this.physics,
                            this.webglManager,
                            nodeData.textureWidth || 512,
                            nodeData.textureHeight || 512,
                            nodeData.name || 'tex_0'
                        );
                        
                        // Restore texture data if available
                        if (nodeData.textureData) {
                            const gl = this.webglManager.gl;
                            const pixels = new Uint8Array(nodeData.textureData);
                            gl.bindTexture(gl.TEXTURE_2D, node.texture);
                            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, node.textureWidth, node.textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                            node.updatePreview();
                        }
                    } else if (nodeData.type === 'shader') {
                        node = new ShaderNode(
                            nodeData.id,
                            nodeData.x,
                            nodeData.y,
                            this.physics,
                            this.webglManager,
                            nodeData.name || 'shad_0'
                        );
                        
                        // Restore inputs and outputs
                        if (nodeData.inputs) {
                            node.inputs = nodeData.inputs;
                            node.updatePorts();
                        } else {
                            node.addInput('input0');
                        }
                        
                        if (nodeData.outputs) {
                            node.outputs = nodeData.outputs;
                            node.updatePorts();
                        } else {
                            node.addOutput('output0');
                        }
                        
                        // Restore shader code
                        if (nodeData.code) {
                            node.code = nodeData.code;
                            // Wait for Monaco to be ready, then set the code
                            setTimeout(() => {
                                if (node.monacoEditor) {
                                    node.monacoEditor.setValue(nodeData.code);
                                    // Update header after code is set
                                    if (this.graph) {
                                        node.updateHeader(this.graph);
                                    }
                                } else {
                                    // Retry if Monaco isn't ready yet
                                    const checkMonaco = setInterval(() => {
                                        if (node.monacoEditor) {
                                            node.monacoEditor.setValue(nodeData.code);
                                            // Update header after code is set
                                            if (this.graph) {
                                                node.updateHeader(this.graph);
                                            }
                                            clearInterval(checkMonaco);
                                        }
                                    }, 100);
                                    setTimeout(() => clearInterval(checkMonaco), 5000);
                                }
                            }, 500);
                        }
                    }
                    
                    if (node) {
                        // Restore position and size
                        node.particle.x = nodeData.x;
                        node.particle.y = nodeData.y;
                        node.setSize(nodeData.width || 200, nodeData.height || 200);
                        node.updatePosition();
                        
                        // Restore name display
                        const titleEl = node.element.querySelector(`[data-node-title="${node.id}"]`);
                        if (titleEl) {
                            titleEl.textContent = nodeData.name || node.name;
                        }
                        
                        this.nodes.push(node);
                        this.graph.addNode(node);
                        this.nodeContainer.appendChild(node.element);
                        this.setupNodeEvents(node);
                        nodeMap.set(nodeData.id, node);
                    }
                }
            }
            
            // Restore connections
            if (state.edges) {
                for (const edgeData of state.edges) {
                    const fromNode = nodeMap.get(edgeData.fromId);
                    const toNode = nodeMap.get(edgeData.toId);
                    
                    if (fromNode && toNode) {
                        // Ensure ports exist
                        if (toNode.type === 'shader') {
                            while (toNode.inputs.length <= edgeData.toPort) {
                                toNode.addInput(`input${toNode.inputs.length}`);
                            }
                        }
                        
                        this.graph.addEdge(fromNode, edgeData.fromPort, toNode, edgeData.toPort);
                    }
                }
                this.updateConnections();
            }
            
            // Update shader headers after a delay to ensure everything is initialized
            setTimeout(() => {
                this.nodes.forEach(node => {
                    if (node.type === 'shader') {
                        node.updateHeader(this.graph);
                    }
                });
            }, 1000); // Wait for Monaco editors to initialize
        } catch (error) {
            console.error('Error loading state:', error);
        }
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        if (this.webglManager.gl) {
            this.webglManager.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    setupConnectionLine() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'connection-line');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'none';
        this.nodeContainer.appendChild(svg);
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke', '#4a9eff');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-dasharray', '5,5');
        this.connectionLine = path;
        svg.appendChild(path);
    }

    createTextureBuffer(x, y) {
        const node = new TextureBufferNode(
            `texture-${this.nodeIdCounter++}`,
            x, y,
            this.physics,
            this.webglManager,
            512,
            512,
            `tex_${this.textureBufferCounter++}`
        );
        this.nodes.push(node);
        this.graph.addNode(node);
        this.nodeContainer.appendChild(node.element);
        this.setupNodeEvents(node);
        this.saveState(); // Save after creating node
        return node;
    }

    createShaderNode(x, y) {
        const node = new ShaderNode(
            `shader-${this.nodeIdCounter++}`,
            x, y,
            this.physics,
            this.webglManager,
            `shad_${this.shaderCounter++}`
        );
        node.addInput('input0');
        node.addOutput('output0');
        this.nodes.push(node);
        this.graph.addNode(node);
        this.nodeContainer.appendChild(node.element);
        this.setupNodeEvents(node);
        this.saveState(); // Save after creating node
        return node;
    }

    setupNodeEvents(node) {
        const header = node.element.querySelector('.node-header');
        if (!header) return;

        // Drag
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.port')) return;
            // Don't start drag if clicking on editable title
            if (e.target.contentEditable === 'true') return;
            if (e.button === 0) { // Only left mouse button
                this.startDrag(node, e);
                e.stopPropagation();
            }
        });

        // Port connections - use event delegation so dynamically added ports work
        node.element.addEventListener('mousedown', (e) => {
            const port = e.target.closest('.port');
            if (port) {
                // Right-click on input port to delete connection
                if (e.button === 2 && port.classList.contains('input')) {
                    this.deleteConnectionAtPort(node, port);
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                this.startConnection(node, port, e);
                e.stopPropagation();
            }
        });
        
        node.element.addEventListener('mouseup', (e) => {
            const port = e.target.closest('.port');
            if (port) {
                this.completeConnection(node, port, e);
                e.stopPropagation();
            }
        });
        
        // Also handle contextmenu for right-click deletion
        node.element.addEventListener('contextmenu', (e) => {
            const port = e.target.closest('.port');
            if (port && port.classList.contains('input')) {
                this.deleteConnectionAtPort(node, port);
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
        // Attach hover listeners to existing ports and set up observer for new ones
        const attachPortHoverListeners = (ports) => {
            ports.forEach(port => {
                port.addEventListener('mouseenter', () => {
                    if (this.connectingFrom && port.classList.contains('input')) {
                        port.style.background = '#5a9eff';
                        port.style.borderColor = '#7bb6ff';
                    }
                });
                
                port.addEventListener('mouseleave', () => {
                    if (this.connectingFrom && port.classList.contains('input')) {
                        port.style.background = '';
                        port.style.borderColor = '';
                    }
                });
            });
        };
        
        // Attach to existing ports
        attachPortHoverListeners(node.element.querySelectorAll('.port'));
        
        // Watch for new ports being added
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('port')) {
                        attachPortHoverListeners([node]);
                    }
                });
            });
        });
        
        observer.observe(node.element, { childList: true, subtree: true });

        // Selection
        node.element.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.port') && !e.target.closest('.node-header')) {
                this.selectNode(node);
            }
        });
    }

    startDrag(node, e) {
        this.dragging = true;
        this.selectedNode = node;
        const rect = node.element.getBoundingClientRect();
        this.dragOffset.x = e.clientX - (node.particle.x);
        this.dragOffset.y = e.clientY - (node.particle.y);
        node.element.classList.add('selected');
        e.preventDefault();
    }

    startConnection(node, port, e) {
        e.stopPropagation();
        e.preventDefault();
        const isInput = port.classList.contains('input');
        const isOutput = port.classList.contains('output');
        
        if (isOutput) {
            this.connectingFrom = node;
            this.connectingFromPort = parseInt(port.dataset.port.split('-')[1]);
            this.connectionLine.style.display = 'block';
        } else if (isInput && this.connectingFrom) {
            // Complete connection on mousedown if already connecting
            this.completeConnection(node, port, e);
        }
    }

    completeConnection(node, port, e) {
        if (!this.connectingFrom) return;
        
        const isInput = port.classList.contains('input');
        if (!isInput) return;
        
        e.stopPropagation();
        e.preventDefault();
        
        const toPort = parseInt(port.dataset.port.split('-')[1]);
        
        // Check if connection is valid
        if (this.connectingFrom === node) {
            // Can't connect to self
            this.cancelConnection();
            return;
        }
        
        this.createConnection(this.connectingFrom, this.connectingFromPort, node, toPort);
        this.cancelConnection();
    }

    cancelConnection() {
        this.connectingFrom = null;
        this.connectingFromPort = null;
        this.connectionLine.style.display = 'none';
        
        // Reset port hover styles
        document.querySelectorAll('.port').forEach(port => {
            if (port.classList.contains('input')) {
                port.style.background = '';
                port.style.borderColor = '';
            }
        });
    }

    deleteConnectionAtPort(node, port) {
        const isInput = port.classList.contains('input');
        if (!isInput) return;
        
        const toPort = parseInt(port.dataset.port.split('-')[1]);
        const edges = this.graph.getEdgesTo(node).filter(edge => edge.toPort === toPort);
        
        for (const edge of edges) {
            this.graph.removeEdge(edge);
        }
        
        this.updateConnections();
        
        // Update shader node headers if it's a shader
        if (node.type === 'shader') {
            node.updateHeader(this.graph);
        }
        
        this.saveState(); // Save after deleting connection
    }

    createConnection(fromNode, fromPort, toNode, toPort) {
        // Check if connection already exists
        const existing = this.graph.edges.find(edge =>
            edge.from === fromNode && edge.fromPort === fromPort &&
            edge.to === toNode && edge.toPort === toPort
        );
        
        if (existing) return;

        // For shader nodes, check if the target port already has a connection
        // If so, automatically use the next available port
        if (toNode.type === 'shader') {
            const existingConnections = this.graph.getEdgesTo(toNode);
            const portInUse = existingConnections.some(edge => edge.toPort === toPort);
            
            if (portInUse) {
                // Find the next available port
                const usedPorts = new Set(existingConnections.map(e => e.toPort));
                let nextPort = toPort;
                while (usedPorts.has(nextPort)) {
                    nextPort++;
                }
                toPort = nextPort;
            }
            
            // Ensure the input port exists
            while (toNode.inputs.length <= toPort) {
                toNode.addInput(`input${toNode.inputs.length}`);
            }
        }

        const edge = this.graph.addEdge(fromNode, fromPort, toNode, toPort);
        this.updateConnections();
        
        // Update shader node headers if connected to a shader
        if (toNode.type === 'shader') {
            toNode.updateHeader(this.graph);
        }
        
        this.saveState(); // Save after creating connection
        return edge;
    }

    updateConnections() {
        // Remove old connection visuals
        const oldConnections = this.nodeContainer.querySelectorAll('.connection-line path:not(:first-child)');
        oldConnections.forEach(c => c.remove());

        const svg = this.connectionLine.parentElement;
        
        // Draw connections
        for (const edge of this.graph.edges) {
            const fromPortType = edge.from.type === 'texture-buffer' ? 'output' : 'output';
            const fromPort = edge.from.element.querySelector(`[data-port="${fromPortType}-${edge.fromPort}"]`);
            const toPort = edge.to.element.querySelector(`[data-port="input-${edge.toPort}"]`);
            
            if (!fromPort || !toPort) continue;

            const fromRect = fromPort.getBoundingClientRect();
            const toRect = toPort.getBoundingClientRect();
            const containerRect = this.nodeContainer.getBoundingClientRect();

            const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
            const y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
            const x2 = toRect.left + toRect.width / 2 - containerRect.left;
            const y2 = toRect.top + toRect.height / 2 - containerRect.top;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const dx = x2 - x1;
            const dy = y2 - y1;
            const cp1x = x1 + dx * 0.5;
            const cp1y = y1;
            const cp2x = x2 - dx * 0.5;
            const cp2y = y2;

            path.setAttribute('d', `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
            path.setAttribute('stroke', '#4a9eff');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            svg.appendChild(path);

            // Update port styles
            fromPort.classList.add('connected');
            toPort.classList.add('connected');
        }
    }

    onCanvasMouseDown(e) {
        if (e.button === 2) { // Right click
            // Check if clicking on a node
            const clickedNode = this.nodes.find(node => {
                const rect = node.element.getBoundingClientRect();
                return e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
            });
            
            if (clickedNode) {
                // Show context menu for the node
                this.showNodeContextMenu(clickedNode, e.clientX, e.clientY);
            } else {
                // Show context menu for canvas
                this.showContextMenu(e.clientX, e.clientY);
            }
        } else if (e.button === 0) { // Left click
            if (!this.dragging) {
                this.selectedNode = null;
                this.nodes.forEach(n => n.element.classList.remove('selected'));
            }
        }
    }

    onCanvasMouseMove(e) {
        // Update connection line during connection
        if (this.connectingFrom) {
            const fromPortType = this.connectingFrom.type === 'texture-buffer' ? 'output' : 'output';
            const fromPort = this.connectingFrom.element.querySelector(`[data-port="${fromPortType}-${this.connectingFromPort}"]`);
            if (fromPort) {
                const fromRect = fromPort.getBoundingClientRect();
                const containerRect = this.nodeContainer.getBoundingClientRect();
                const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
                const y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
                const x2 = e.clientX - containerRect.left;
                const y2 = e.clientY - containerRect.top;

                const dx = x2 - x1;
                const cp1x = x1 + dx * 0.5;
                const cp1y = y1;
                const cp2x = x2 - dx * 0.5;
                const cp2y = y2;

                this.connectionLine.setAttribute('d', `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
            }
        }

        // Handle dragging
        if (this.dragging && this.selectedNode) {
            const node = this.selectedNode;
            node.particle.x = e.clientX - this.dragOffset.x;
            node.particle.y = e.clientY - this.dragOffset.y;
            node.particle.vx = 0;
            node.particle.vy = 0;
        }
    }

    onCanvasMouseUp(e) {
        if (this.dragging) {
            this.dragging = false;
            if (this.selectedNode) {
                // Give the node a small velocity to help physics settle
                this.selectedNode.particle.vx = 0;
                this.selectedNode.particle.vy = 0;
            }
        }
        // Don't cancel connection on canvas mouseup - let port mouseup handle it
        // Only cancel if clicking on canvas (not on a port)
        if (this.connectingFrom && e.button === 0 && !e.target.closest('.port')) {
            this.cancelConnection();
        }
    }

    showNodeContextMenu(node, x, y) {
        const menu = document.createElement('div');
        menu.style.position = 'fixed';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.background = '#1a1a1a';
        menu.style.border = '1px solid #333';
        menu.style.borderRadius = '4px';
        menu.style.padding = '4px';
        menu.style.zIndex = '1000';
        menu.style.minWidth = '150px';

        const items = [
            { label: 'Delete Node', action: () => this.removeNode(node) },
        ];

        items.forEach(item => {
            const div = document.createElement('div');
            div.textContent = item.label;
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.color = '#e0e0e0';
            div.addEventListener('mouseenter', () => div.style.background = '#2a2a2a');
            div.addEventListener('mouseleave', () => div.style.background = 'transparent');
            div.addEventListener('click', () => {
                item.action();
                menu.remove();
            });
            menu.appendChild(div);
        });

        document.body.appendChild(menu);

        const removeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', removeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', removeMenu), 0);
    }

    showContextMenu(x, y) {
        const menu = document.createElement('div');
        menu.style.position = 'fixed';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.background = '#1a1a1a';
        menu.style.border = '1px solid #333';
        menu.style.borderRadius = '4px';
        menu.style.padding = '4px';
        menu.style.zIndex = '1000';
        menu.style.minWidth = '150px';

        const items = [
            { label: 'Create Texture Buffer', action: () => this.createTextureBuffer(x, y) },
            { label: 'Create Shader Node', action: () => this.createShaderNode(x, y) },
        ];

        items.forEach(item => {
            const div = document.createElement('div');
            div.textContent = item.label;
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.color = '#e0e0e0';
            div.addEventListener('mouseenter', () => div.style.background = '#2a2a2a');
            div.addEventListener('mouseleave', () => div.style.background = 'transparent');
            div.addEventListener('click', () => {
                item.action();
                menu.remove();
            });
            menu.appendChild(div);
        });

        document.body.appendChild(menu);

        const removeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', removeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', removeMenu), 0);
    }

    selectNode(node) {
        this.nodes.forEach(n => n.element.classList.remove('selected'));
        node.element.classList.add('selected');
        this.selectedNode = node;
    }

    onKeyDown(e) {
        if (e.key === 'Delete' && this.selectedNode) {
            this.removeNode(this.selectedNode);
        }
    }

    removeNode(node) {
        const index = this.nodes.indexOf(node);
        if (index > -1) {
            // Find all shader nodes that were connected to this node
            const connectedShaders = new Set();
            const edgesToRemove = this.graph.getEdgesFrom(node);
            edgesToRemove.forEach(edge => {
                if (edge.to.type === 'shader') {
                    connectedShaders.add(edge.to);
                }
            });
            const edgesFromRemove = this.graph.getEdgesTo(node);
            edgesFromRemove.forEach(edge => {
                if (edge.from.type === 'shader') {
                    connectedShaders.add(edge.from);
                }
            });
            
            this.nodes.splice(index, 1);
            this.graph.removeNode(node);
            node.destroy();
            this.updateConnections();
            
            // Update headers of all affected shader nodes
            connectedShaders.forEach(shaderNode => {
                shaderNode.updateHeader(this.graph);
            });
            
            this.saveState(); // Save after deleting node
        }
    }

    animate() {
        // Physics step
        this.physics.step();
        
        // Update node positions
        this.nodes.forEach(node => node.updatePosition());
        
        // Update connections
        this.updateConnections();
        
        // Render background
        const gl = this.webglManager.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        requestAnimationFrame(() => this.animate());
    }

    evaluateGraph() {
        // Check if physics has settled
        const settled = this.physics.particles.every(p => 
            Math.abs(p.vx) < 0.1 && Math.abs(p.vy) < 0.1
        );

        if (settled) {
            this.graph.evaluate(this.webglManager, this.iteration);
            this.iteration++;
            
            // Update texture buffer previews
            this.nodes.forEach(node => {
                if (node.type === 'texture-buffer') {
                    node.updatePreview();
                }
            });
        }

        setTimeout(() => this.evaluateGraph(), 100);
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.app = new App();
    });
} else {
    window.app = new App();
}

