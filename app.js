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
        this.panning = false;
        this.panStart = { x: 0, y: 0 };
        this.panOffset = { x: 0, y: 0 };
        this.zoom = 1.0;
        this.zoomMin = 0.1;
        this.zoomMax = 5.0;
        
        this.nodeIdCounter = 0;
        this.textureBufferCounter = 0;
        this.shaderCounter = 0;
        this.iteration = 0;
        this.paused = false;
        this.paletteNode = null;
        this.connectionsNeedUpdate = true; // Track if connections need visual update
        
        // FPS tracking
        this.fps = 0;
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        
        this.init();
    }

    init() {
        // Initialize WebGL (canvas only needs to exist for context, doesn't need to be visible or full-screen)
        this.webglManager.init(this.canvas);
        
        // Load saved state now that WebGL is ready
        this.loadState();
        
        // Setup connection line SVG
        this.setupConnectionLine();
        
        // Event listeners - use #app div instead of canvas for mouse events
        const appDiv = document.getElementById('app');
        appDiv.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        appDiv.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        appDiv.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        appDiv.addEventListener('contextmenu', (e) => e.preventDefault());
        appDiv.addEventListener('wheel', (e) => this.onCanvasWheel(e), { passive: false });
        
        // Global mouse events for dragging (so dragging works even outside canvas)
        document.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        
        // Stop dragging/panning if mouse leaves window
        window.addEventListener('mouseleave', (e) => {
            if (this.dragging) {
                this.dragging = false;
                if (this.selectedNode) {
                    this.selectedNode.particle.vx = 0;
                    this.selectedNode.particle.vy = 0;
                }
            }
            if (this.panning) {
                this.panning = false;
                document.getElementById('app').style.cursor = '';
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        
        // Create pause/play button
        this.createPauseButton();
        
        // Physics and render loop
        this.animate();
        
        // Graph evaluation loop
        this.evaluateGraph();
        
        // Set up auto-save
        this.setupAutoSave();
    }

    createPauseButton() {
        // Create container for pause button
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
        container.style.zIndex = '1000';
        
        // Create pause button
        const button = document.createElement('button');
        button.id = 'pause-button';
        button.textContent = '⏸ Pause';
        button.style.padding = '10px 20px';
        button.style.background = '#2a2a2a';
        button.style.border = '1px solid #555';
        button.style.borderRadius = '4px';
        button.style.color = '#e0e0e0';
        button.style.cursor = 'pointer';
        button.style.fontSize = '14px';
        button.style.fontFamily = 'inherit';
        
        button.addEventListener('mouseenter', () => {
            button.style.background = '#3a3a3a';
        });
        button.addEventListener('mouseleave', () => {
            button.style.background = '#2a2a2a';
        });
        
        button.addEventListener('click', () => {
            this.togglePause();
        });
        
        container.appendChild(button);
        document.body.appendChild(container);
        this.pauseButton = button;
    }

    togglePause() {
        this.paused = !this.paused;
        if (this.paused) {
            this.pauseButton.textContent = '▶ Play';
        } else {
            this.pauseButton.textContent = '⏸ Pause';
        }
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
                        // Don't save texture pixel data - it's too large for localStorage
                        // Texture data will be regenerated from shader computations on load
                        // Only save if it's a manually drawn texture (we could add a flag for this later)
                        nodeData.textureData = null; // Skip saving texture data to avoid quota issues
                    } else if (node.type === 'shader') {
                        nodeData.code = node.code || (node.monacoEditor ? node.monacoEditor.getValue() : '');
                        nodeData.inputs = node.inputs.map(inp => ({ name: inp.name, port: inp.port }));
                        nodeData.outputs = node.outputs.map(out => ({ name: out.name, port: out.port }));
                    } else if (node.type === 'palette') {
                        nodeData.colors = node.colors;
                        nodeData.selectedColorIndex = node.selectedColorIndex;
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
                        
                        // Don't restore texture data - textures will be regenerated from shader computations
                        // Initialize with empty texture (black)
                        const gl = this.webglManager.gl;
                        const data = new Uint8Array(node.textureWidth * node.textureHeight * 4);
                        gl.bindTexture(gl.TEXTURE_2D, node.texture);
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, node.textureWidth, node.textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
                        // Preview will be updated after graph evaluation
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
                    } else if (nodeData.type === 'palette') {
                        node = new PaletteNode(
                            nodeData.id,
                            nodeData.x,
                            nodeData.y,
                            this.physics
                        );
                        
                        // Restore colors and selection
                        if (nodeData.colors) {
                            node.colors = nodeData.colors;
                        }
                        if (nodeData.selectedColorIndex !== undefined) {
                            node.selectedColorIndex = nodeData.selectedColorIndex;
                        }
                        if (nodeData.expanded !== undefined) {
                            node.expanded = nodeData.expanded;
                            // Update expand button if needed
                            const expandBtn = node.element.querySelector('.palette-expand-btn');
                            if (expandBtn) {
                                expandBtn.textContent = node.expanded ? '▼' : '▶';
                            }
                            const controls = node.element.querySelector(`#palette-controls-${node.id}`);
                            if (controls) {
                                controls.style.display = node.expanded ? 'block' : 'none';
                            }
                        }
                        node.renderColors();
                    }
                    
                    if (node) {
                        // Store palette node reference
                        if (node.type === 'palette') {
                            this.paletteNode = node;
                        }
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
                
                // Evaluate graph once to regenerate textures from shaders
                setTimeout(() => {
                    this.graph.evaluate(this.webglManager, 0);
                    // Update all texture buffer previews
                    this.nodes.forEach(node => {
                        if (node.type === 'texture-buffer') {
                            node.updatePreview();
                        }
                    });
                }, 500);
            }, 1000); // Wait for Monaco editors to initialize
        } catch (error) {
            console.error('Error loading state:', error);
        }
    }


    setupConnectionLine() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'connection-line');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        // Make SVG extremely large to cover all possible node positions
        svg.setAttribute('width', '50000');
        svg.setAttribute('height', '50000');
        svg.setAttribute('viewBox', '0 0 50000 50000');
        svg.style.pointerEvents = 'none';
        // Center the viewBox around the origin
        svg.style.transform = 'translate(-25000px, -25000px)';
        this.nodeContainer.appendChild(svg);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke', '#4a9eff');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-dasharray', '5,5');
        path.setAttribute('opacity', '0.25');
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

    createPaletteNode(x, y) {
        // Only allow one palette node
        if (this.paletteNode) {
            return this.paletteNode;
        }
        
        const node = new PaletteNode(
            `palette-${this.nodeIdCounter++}`,
            x, y,
            this.physics
        );
        this.nodes.push(node);
        this.graph.addNode(node);
        this.nodeContainer.appendChild(node.element);
        this.setupNodeEvents(node);
        this.paletteNode = node;
        this.saveState();
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
        // Convert viewport coordinates to unscaled coordinate space
        const containerRect = this.nodeContainer.getBoundingClientRect();
        const unscaledX = (e.clientX - containerRect.left) / this.zoom;
        const unscaledY = (e.clientY - containerRect.top) / this.zoom;
        this.dragOffset.x = unscaledX - node.particle.x;
        this.dragOffset.y = unscaledY - node.particle.y;
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
        
        this.connectionsNeedUpdate = true;
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
        this.connectionsNeedUpdate = true;
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

        const svg = this.connectionLine?.parentElement;
        if (!svg) return; // Connection line not initialized yet
        
        // Draw connections
        for (const edge of this.graph.edges) {
            const fromPortType = edge.from.type === 'texture-buffer' ? 'output' : 'output';
            const fromPort = edge.from.element.querySelector(`[data-port="${fromPortType}-${edge.fromPort}"]`);
            const toPort = edge.to.element.querySelector(`[data-port="input-${edge.toPort}"]`);
            
            if (!fromPort || !toPort) continue;

            const fromRect = fromPort.getBoundingClientRect();
            const toRect = toPort.getBoundingClientRect();
            const containerRect = this.nodeContainer.getBoundingClientRect();

            // Calculate coordinates relative to container, then divide by zoom to get SVG coordinates
            // Offset by 25000 to center in the large SVG viewBox
            const x1 = (fromRect.left + fromRect.width / 2 - containerRect.left) / this.zoom + 25000;
            const y1 = (fromRect.top + fromRect.height / 2 - containerRect.top) / this.zoom + 25000;
            const x2 = (toRect.left + toRect.width / 2 - containerRect.left) / this.zoom + 25000;
            const y2 = (toRect.top + toRect.height / 2 - containerRect.top) / this.zoom + 25000;

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
            path.setAttribute('opacity', '0.25');
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
            // Check if clicking on background (not on a node or port)
            const clickedNode = this.nodes.find(node => {
                const rect = node.element.getBoundingClientRect();
                return e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
            });
            
            if (!clickedNode && !this.connectingFrom) {
                // Unselect any selected nodes
                this.selectedNode = null;
                this.nodes.forEach(n => n.element.classList.remove('selected'));
                // Start panning
                this.panning = true;
                this.panStart.x = e.clientX;
                this.panStart.y = e.clientY;
                document.getElementById('app').style.cursor = 'grabbing';
                e.preventDefault();
            } else if (!this.dragging) {
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
                // Divide by zoom to get SVG coordinates, offset by 25000 to center in large SVG
                const x1 = (fromRect.left + fromRect.width / 2 - containerRect.left) / this.zoom + 25000;
                const y1 = (fromRect.top + fromRect.height / 2 - containerRect.top) / this.zoom + 25000;
                const x2 = (e.clientX - containerRect.left) / this.zoom + 25000;
                const y2 = (e.clientY - containerRect.top) / this.zoom + 25000;

                const dx = x2 - x1;
                const cp1x = x1 + dx * 0.5;
                const cp1y = y1;
                const cp2x = x2 - dx * 0.5;
                const cp2y = y2;

                this.connectionLine.setAttribute('d', `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
            }
        }

        // Handle panning
        if (this.panning) {
            // Convert viewport coordinates to unscaled coordinate space
            const containerRect = this.nodeContainer.getBoundingClientRect();
            const unscaledX = (e.clientX - containerRect.left) / this.zoom;
            const unscaledY = (e.clientY - containerRect.top) / this.zoom;
            const unscaledStartX = (this.panStart.x - containerRect.left) / this.zoom;
            const unscaledStartY = (this.panStart.y - containerRect.top) / this.zoom;
            
            const dx = unscaledX - unscaledStartX;
            const dy = unscaledY - unscaledStartY;
            
            // Move all nodes
            this.nodes.forEach(node => {
                node.particle.x += dx;
                node.particle.y += dy;
            });
            
            // Update pan start for next move (in viewport coordinates)
            this.panStart.x = e.clientX;
            this.panStart.y = e.clientY;
        }

        // Handle dragging
        if (this.dragging && this.selectedNode) {
            const node = this.selectedNode;
            // Convert viewport coordinates to unscaled coordinate space
            const containerRect = this.nodeContainer.getBoundingClientRect();
            const unscaledX = (e.clientX - containerRect.left) / this.zoom;
            const unscaledY = (e.clientY - containerRect.top) / this.zoom;
            node.particle.x = unscaledX - this.dragOffset.x;
            node.particle.y = unscaledY - this.dragOffset.y;
            node.particle.vx = 0;
            node.particle.vy = 0;
        }
        
        // Update cursor style when hovering over background
        if (!this.panning && !this.dragging && !this.connectingFrom) {
            const hoveredNode = this.nodes.find(node => {
                const rect = node.element.getBoundingClientRect();
                return e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
            });
            if (!hoveredNode) {
                document.getElementById('app').style.cursor = 'grab';
            } else {
                document.getElementById('app').style.cursor = '';
            }
        }
    }

    onCanvasWheel(e) {
        // Only zoom when scrolling on background (not on a node)
        const clickedNode = this.nodes.find(node => {
            const rect = node.element.getBoundingClientRect();
            return e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top && e.clientY <= rect.bottom;
        });
        
        if (clickedNode) return; // Don't zoom if scrolling over a node
        
        e.preventDefault();
        
        // Calculate zoom delta (negative deltaY = zoom in, positive = zoom out)
        const zoomDelta = -e.deltaY * 0.0003; // Reduced sensitivity for smoother zooming
        const newZoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + zoomDelta));
        
        if (newZoom !== this.zoom) {
            this.zoom = newZoom;
            this.applyZoom();
        }
    }
    
    applyZoom() {
        // Apply zoom transform to node container (this will also scale the connection SVG inside it)
        this.nodeContainer.style.transform = `scale(${this.zoom})`;
        this.nodeContainer.style.transformOrigin = 'top left';
        // Update connections to use correct coordinates for the new zoom level
        this.connectionsNeedUpdate = true;
        this.updateConnections();
        // Update canvas sizes for all texture buffer nodes to account for new zoom level
        this.nodes.forEach(node => {
            if (node.type === 'texture-buffer' && node.updateCanvasSize) {
                node.updateCanvasSize();
            }
        });
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
        
        if (this.panning) {
            this.panning = false;
            document.getElementById('app').style.cursor = '';
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
            { label: 'Create Palette', action: () => this.createPaletteNode(x, y) },
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
            this.connectionsNeedUpdate = true;
            this.updateConnections();
            
            // Update headers of all affected shader nodes
            connectedShaders.forEach(shaderNode => {
                shaderNode.updateHeader(this.graph);
            });
            
            this.saveState(); // Save after deleting node
        }
    }

    animate() {
        // Update FPS
        this.frameCount++;
        const now = performance.now();
        const elapsed = now - this.lastFpsUpdate;
        
        if (elapsed >= 1000) { // Update FPS every second
            this.fps = Math.round((this.frameCount * 1000) / elapsed);
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            
            // FPS display on texture buffer nodes is now tracked per-node in updatePreview()
        }
        
        if (!this.paused) {
            // Physics step
            this.physics.step();
            
            // Update node positions
            this.nodes.forEach(node => node.updatePosition());
        }
        
        // Update connections
        this.updateConnections();
        
        // Update texture buffer previews every frame for 60 FPS
        this.nodes.forEach(node => {
            if (node.type === 'texture-buffer') {
                node.updatePreview();
            }
        });
        
        requestAnimationFrame(() => this.animate());
    }

    evaluateGraph() {
        if (!this.paused) {
            // Check if physics has settled
            const settled = this.physics.particles.every(p => 
                Math.abs(p.vx) < 0.1 && Math.abs(p.vy) < 0.1
            );

            if (settled) {
                this.graph.evaluate(this.webglManager, this.iteration);
                this.iteration++;
            }
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

