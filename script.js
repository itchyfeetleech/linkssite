"use strict";

window.addEventListener("DOMContentLoaded", () => {
    // User links
    window.LINKS = {
        faceit: "https://www.faceit.com/en/players/HoppCX",
        leetify: "https://leetify.com/app/profile/76561198198305361",
        deadlock: "https://tracklock.gg/players/238039633",
        valorant: "https://tracker.gg/valorant/profile/riot/HoppCX%23000/",
        overwatch: "https://www.overbuff.com/players/HoppCX-1509",
        marvel: "https://tracker.gg/marvel-rivals/profile/ign/HoppCX/",
        youtube: "https://www.youtube.com/@HoppCX"
    };

    // Apply links
    (function applyLinks() {
        const ids = ["faceit", "leetify", "deadlock", "valorant", "overwatch", "marvel", "youtube"];
        ids.forEach((id) => {
            const a = document.getElementById(id);
            const url = window.LINKS[id];
            if (a && url && typeof url === 'string') a.href = url;
        });
    })();

    // WebGL background animation
    (function webglBG() {
        const canvas = document.getElementById('bgCanvas');
        const gl = canvas?.getContext('webgl');
        if (!canvas || !gl) return;

        const vertSrc = `
      attribute vec2 position;
      void main(){ gl_Position = vec4(position, 0.0, 1.0); }
    `;
        const fragSrc = `
      precision mediump float;
      uniform vec2 u_res;
      uniform float u_time;
      uniform vec3 u_color1;
      uniform vec3 u_color2;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0,0.0));
        float c = hash(i + vec2(0.0,1.0));
        float d = hash(i + vec2(1.0,1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
      }
      void main(){
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        float n = noise(uv*3.0 + u_time*0.02);
        vec3 col = mix(u_color1, u_color2, n);
        gl_FragColor = vec4(col, 1.0);
      }
    `;

        function compile(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                console.error('Shader compile error:', gl.getShaderInfoLog(sh));
            }
            return sh;
        }

        const vs = compile(gl.VERTEX_SHADER, vertSrc);
        const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(prog));
            return;
        }
        gl.useProgram(prog);

        const posLoc = gl.getAttribLocation(prog, 'position');
        const timeLoc = gl.getUniformLocation(prog, 'u_time');
        const resLoc = gl.getUniformLocation(prog, 'u_res');
        const color1Loc = gl.getUniformLocation(prog, 'u_color1');
        const color2Loc = gl.getUniformLocation(prog, 'u_color2');

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            gl.viewport(0, 0, canvas.width, canvas.height);
        }
        window.addEventListener('resize', resize);
        resize();

        // Palette (Float32Array for Safari)
        const palette = [
            new Float32Array([0.96, 0.96, 0.97]),
            new Float32Array([0.86, 0.87, 0.89])
        ];
        gl.uniform3fv(color1Loc, palette[0]);
        gl.uniform3fv(color2Loc, palette[1]);

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        function render(t) {
            gl.uniform1f(timeLoc, t * 0.001);
            gl.uniform2f(resLoc, canvas.width, canvas.height);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(render);
        }
        requestAnimationFrame(render);
    })();

    // Dense volumetric smoke that falls from the top and collides with link buttons
    (function smoke() {
        const canvas = document.getElementById('smokeCanvas');
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        let w = 0, h = 0;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const obstacles = [];
        const particles = [];

        // simple value noise used to sway particles
        const rand = (x, y) => {
            const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
        const noise = (x, y) => {
            const ix = Math.floor(x), iy = Math.floor(y);
            const fx = x - ix, fy = y - iy;
            const a = rand(ix, iy);
            const b = rand(ix + 1, iy);
            const c = rand(ix, iy + 1);
            const d = rand(ix + 1, iy + 1);
            const u = fx * fx * (3 - 2 * fx);
            const v = fy * fy * (3 - 2 * fy);
            return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
        };

        function captureObstacles() {
            obstacles.length = 0;
            document.querySelectorAll('.link').forEach(el => {
                const r = el.getBoundingClientRect();
                obstacles.push({ x: r.left, y: r.top, w: r.width, h: r.height });
            });
        }

        function resize() {
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            captureObstacles();

            const desired = Math.min(Math.round((w * h) / 1500), 400);
            const diff = desired - particles.length;
            if (diff > 0) {
                for (let i = 0; i < diff; i++) particles.push(new Particle());
            } else if (diff < 0) {
                particles.length = desired;
            }
        }

        class Particle {
            constructor() { this.reset(); }
            reset() {
                this.x = Math.random() * w;
                this.y = -Math.random() * h - 50;
                this.z = Math.random();
                this.size = 60 + this.z * 80;
                this.vx = 0;
                this.vy = 20 + Math.random() * 20;
                this.alpha = 0.2 + (1 - this.z) * 0.3;
            }
            update(dt, t) {
                const wind = noise(this.x * 0.005, (this.y + t * 20) * 0.005) - 0.5;
                this.vx += wind * 20 * dt;
                this.x += this.vx * dt;
                this.y += this.vy * dt;

                const r = this.size;
                for (const ob of obstacles) {
                    if (this.x + r > ob.x && this.x - r < ob.x + ob.w && this.y + r > ob.y && this.y - r < ob.y + ob.h) {
                        const overlapX = Math.min(ob.x + ob.w - (this.x - r), (this.x + r) - ob.x);
                        const overlapY = Math.min(ob.y + ob.h - (this.y - r), (this.y + r) - ob.y);
                        if (overlapX < overlapY) {
                            if (this.x < ob.x + ob.w / 2) this.x = ob.x - r; else this.x = ob.x + ob.w + r;
                            this.vx *= -0.4;
                        } else {
                            if (this.y < ob.y + ob.h / 2) this.y = ob.y - r; else this.y = ob.y + ob.h + r;
                            this.vy *= -0.4;
                        }
                    }
                }

                if (this.y - r > h) this.reset();
            }
            draw(ctx) {
                const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
                g.addColorStop(0, 'rgba(255,255,255,0.6)');
                g.addColorStop(0.5, 'rgba(200,200,210,0.3)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.globalAlpha = this.alpha;
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        window.addEventListener('resize', resize);
        resize();

        let last = performance.now();
        function step(now) {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            const t = now / 1000;

            ctx.clearRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'lighter';
            particles.sort((a, b) => a.z - b.z);
            for (const p of particles) { p.update(dt, t); p.draw(ctx); }
            ctx.globalCompositeOperation = 'source-over';
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    })();

    // Subtle 3D tilt on hover
    (function tilt() {
        const links = document.querySelectorAll('.link');
        const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

        links.forEach((el) => {
            let raf = null;

            const onMove = (e) => {
                const r = el.getBoundingClientRect();
                const px = (e.clientX - r.left) / r.width;
                const py = (e.clientY - r.top) / r.height;
                const rotY = clamp((px - 0.5) * 8, -8, 8);
                const rotX = clamp((0.5 - py) * 6, -6, 6);
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                    el.style.setProperty('--tiltX', rotX.toFixed(2) + 'deg');
                    el.style.setProperty('--tiltY', rotY.toFixed(2) + 'deg');
                });
            };

            const reset = () => {
                if (raf) cancelAnimationFrame(raf);
                el.style.setProperty('--tiltX', '0deg');
                el.style.setProperty('--tiltY', '0deg');
            };

            el.addEventListener('mousemove', onMove);
            el.addEventListener('mouseleave', reset);
            el.addEventListener('touchstart', reset, { passive: true });
            el.addEventListener('touchend', reset, { passive: true });
        });
    })();

    // Ambient breathing of text weight
    (function breathe() {
        const root = document.documentElement;
        let t = 0;
        setInterval(() => {
            const base = parseFloat(getComputedStyle(root).getPropertyValue('--wght-base')) || 600;
            const weight = base + Math.sin(t) * 50;
            root.style.setProperty('--wght', weight.toFixed(0));
            t += 0.04;
        }, 100);
    })();
});
