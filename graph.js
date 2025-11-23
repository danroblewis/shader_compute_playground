class Graph {
    constructor() {
        this.nodes = [];
        this.edges = [];
        this.nodeMap = new Map();
    }

    addNode(node) {
        this.nodes.push(node);
        this.nodeMap.set(node.id, node);
        return node;
    }

    removeNode(node) {
        const index = this.nodes.indexOf(node);
        if (index > -1) {
            this.nodes.splice(index, 1);
            this.nodeMap.delete(node.id);
            // Remove connected edges
            this.edges = this.edges.filter(edge => 
                edge.from !== node && edge.to !== node
            );
        }
    }

    addEdge(fromNode, fromPort, toNode, toPort) {
        const edge = { from: fromNode, fromPort, to: toNode, toPort };
        this.edges.push(edge);
        return edge;
    }

    removeEdge(edge) {
        const index = this.edges.indexOf(edge);
        if (index > -1) {
            this.edges.splice(index, 1);
        }
    }

    getEdgesFrom(node, port = null) {
        return this.edges.filter(edge => 
            edge.from === node && (port === null || edge.fromPort === port)
        );
    }

    getEdgesTo(node, port = null) {
        return this.edges.filter(edge => 
            edge.to === node && (port === null || edge.toPort === port)
        );
    }

    // Topological sort with cycle detection
    getEvaluationOrder() {
        const visited = new Set();
        const visiting = new Set();
        const result = [];
        const cycles = [];

        const visit = (node) => {
            if (visiting.has(node.id)) {
                // Cycle detected
                cycles.push(node);
                return;
            }
            if (visited.has(node.id)) {
                return;
            }

            visiting.add(node.id);
            
            // Visit dependencies first
            const incomingEdges = this.getEdgesTo(node);
            for (const edge of incomingEdges) {
                visit(edge.from);
            }

            visiting.delete(node.id);
            visited.add(node.id);
            result.push(node);
        };

        for (const node of this.nodes) {
            if (!visited.has(node.id)) {
                visit(node);
            }
        }

        return { order: result, cycles };
    }

    // Evaluate graph, handling cycles
    evaluate(webglManager, iteration = 0) {
        const { order, cycles } = this.getEvaluationOrder();
        
        // Evaluate nodes in topological order (nodes with no dependencies first)
        for (const node of order) {
            if (node.type === 'shader') {
                // Shader nodes: evaluate and render to output texture
                node.evaluate(webglManager, this);
                
                // Update connected texture buffers automatically
                const outgoingEdges = this.getEdgesFrom(node);
                for (const edge of outgoingEdges) {
                    const targetNode = edge.to;
                    if (targetNode.type === 'texture-buffer') {
                        // The shader already rendered to the texture buffer's texture
                        // Just update the preview
                        targetNode.updatePreview();
                    }
                }
            } else if (node.type === 'texture-buffer') {
                // Texture buffers: update from input connections
                this.updateTextureBufferInput(node);
                // Update preview after input is set
                node.updatePreview();
            }
        }

        // Handle cycles - evaluate them in sequence
        if (cycles.length > 0) {
            // Find all nodes in cycles
            const cycleNodes = new Set();
            for (const cycleNode of cycles) {
                cycleNodes.add(cycleNode);
                // Add all nodes connected in cycles
                const findCycleNodes = (node, visited = new Set()) => {
                    if (visited.has(node.id)) return;
                    visited.add(node.id);
                    cycleNodes.add(node);
                    
                    const outgoing = this.getEdgesFrom(node);
                    const incoming = this.getEdgesTo(node);
                    
                    for (const edge of outgoing) {
                        if (this.getEdgesTo(edge.to).some(e => e.from === node || cycles.includes(e.from))) {
                            findCycleNodes(edge.to, visited);
                        }
                    }
                    for (const edge of incoming) {
                        if (this.getEdgesFrom(edge.from).some(e => e.to === node || cycles.includes(e.to))) {
                            findCycleNodes(edge.from, visited);
                        }
                    }
                };
                findCycleNodes(cycleNode);
            }

            // Evaluate cycle nodes
            for (const node of Array.from(cycleNodes)) {
                if (node.type === 'shader') {
                    node.evaluate(webglManager, this);
                    
                    // Update connected texture buffers automatically
                    const outgoingEdges = this.getEdgesFrom(node);
                    for (const edge of outgoingEdges) {
                        const targetNode = edge.to;
                        if (targetNode.type === 'texture-buffer') {
                            targetNode.updatePreview();
                        }
                    }
                } else if (node.type === 'texture-buffer') {
                    this.updateTextureBufferInput(node);
                    node.updatePreview();
                }
            }
        }
    }

    updateTextureBufferInput(textureBuffer) {
        const incomingEdges = this.getEdgesTo(textureBuffer);
        for (const edge of incomingEdges) {
            if (edge.toPort === 0) { // texture buffers only have one input port
                const sourceNode = edge.from;
                let sourceTexture = null;
                
                if (sourceNode.type === 'texture-buffer') {
                    sourceTexture = sourceNode.getOutputTexture();
                } else if (sourceNode.type === 'shader') {
                    sourceTexture = sourceNode.getOutputTexture(edge.fromPort);
                }
                
                if (sourceTexture) {
                    textureBuffer.setInputTexture(sourceTexture);
                }
            }
        }
    }
}

