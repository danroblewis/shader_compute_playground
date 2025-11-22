class PhysicsEngine {
    constructor() {
        this.particles = [];
        this.springs = [];
        this.damping = 0.85;
        this.springStrength = 0.1;
        this.springDamping = 0.9;
        this.minDistance = 100;
        this.maxDistance = 300;
    }

    addParticle(x, y, mass = 1, width = 200, height = 200) {
        const particle = {
            x, y,
            vx: 0, vy: 0,
            fx: 0, fy: 0,
            mass,
            width,
            height,
            id: this.particles.length
        };
        this.particles.push(particle);
        return particle;
    }

    removeParticle(particle) {
        const index = this.particles.indexOf(particle);
        if (index > -1) {
            this.particles.splice(index, 1);
            // Remove springs connected to this particle
            this.springs = this.springs.filter(spring => 
                spring.p1 !== particle && spring.p2 !== particle
            );
        }
    }

    addSpring(p1, p2, restLength = null) {
        if (restLength === null) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            restLength = Math.sqrt(dx * dx + dy * dy);
        }
        const spring = { p1, p2, restLength };
        this.springs.push(spring);
        return spring;
    }

    removeSpring(spring) {
        const index = this.springs.indexOf(spring);
        if (index > -1) {
            this.springs.splice(index, 1);
        }
    }

    updateParticleSize(particle, width, height) {
        particle.width = width;
        particle.height = height;
    }

    step(dt = 0.016) {
        // Reset forces
        for (const p of this.particles) {
            p.fx = 0;
            p.fy = 0;
        }

        // Apply spring forces
        for (const spring of this.springs) {
            const p1 = spring.p1;
            const p2 = spring.p2;
            
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist > 0.001) {
                const targetDist = spring.restLength;
                const diff = dist - targetDist;
                const force = diff * this.springStrength;
                
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                
                p1.fx += fx;
                p1.fy += fy;
                p2.fx -= fx;
                p2.fy -= fy;
                
                // Spring damping
                const relVx = p2.vx - p1.vx;
                const relVy = p2.vy - p1.vy;
                const dampingForce = (relVx * dx + relVy * dy) / (dist * dist) * this.springDamping;
                p1.vx += dampingForce * dx * dt;
                p1.vy += dampingForce * dy * dt;
                p2.vx -= dampingForce * dx * dt;
                p2.vy -= dampingForce * dy * dt;
            }
        }

        // Apply repulsion between nearby particles (to prevent overlap)
        for (let i = 0; i < this.particles.length; i++) {
            for (let j = i + 1; j < this.particles.length; j++) {
                const p1 = this.particles[i];
                const p2 = this.particles[j];
                
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = (p1.width + p2.width) / 2 + 20;
                
                if (dist < minDist && dist > 0.001) {
                    const overlap = minDist - dist;
                    const force = overlap * 0.01;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    
                    p1.fx -= fx;
                    p1.fy -= fy;
                    p2.fx += fx;
                    p2.fy += fy;
                }
            }
        }

        // Update velocities and positions
        for (const p of this.particles) {
            p.vx += p.fx * dt;
            p.vy += p.fy * dt;
            
            p.vx *= this.damping;
            p.vy *= this.damping;
            
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
    }

    getParticleAt(x, y) {
        for (const p of this.particles) {
            if (x >= p.x - p.width / 2 && x <= p.x + p.width / 2 &&
                y >= p.y - p.height / 2 && y <= p.y + p.height / 2) {
                return p;
            }
        }
        return null;
    }
}

