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

    // Smoke particle system
    (function smoke() {
        const canvas = document.getElementById('smokeCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let w = 0, h = 0;
        const DPR = Math.max(1, window.devicePixelRatio || 1);

        function resize() {
            w = window.innerWidth; h = window.innerHeight;
            canvas.width = Math.floor(w * DPR);
            canvas.height = Math.floor(h * DPR);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        }
        window.addEventListener('resize', resize);
        resize();

        class Particle {
            constructor() { this.reset(); }
            reset() {
                this.x = Math.random() * w;
                this.y = h * (0.6 + Math.random() * 0.4);
                this.vx = (Math.random() - 0.5) * 0.3;
                this.vy = - (0.2 + Math.random() * 0.8);
                this.size = 80 + Math.random() * 120;
                this.life = 12 + Math.random() * 10;
                this.age = 0;
                this.rotation = Math.random() * Math.PI * 2;
                this.spin = (Math.random() - 0.5) * 0.002;
                // +130% visibility vs previous
                this.alpha = (0.096 + Math.random() * 0.168) * 2.3;
                this.rim = 'rgba(120,120,130,0.18)'; // slightly stronger rim
            }
            update(dt) {
                this.age += dt;
                if (this.age > this.life) { this.reset(); }
                this.x += this.vx * dt * 60;
                this.y += this.vy * dt * 60;
                this.vx += (Math.random() - 0.5) * 0.01;
                this.rotation += this.spin * dt * 60;
                const t = Math.max(0, Math.min(1, this.age / this.life));
                this.currentAlpha = this.alpha * (1 - t);
            }
            draw(ctx) {
                ctx.save();
                ctx.globalCompositeOperation = 'source-over';
                ctx.globalAlpha = this.currentAlpha;
                ctx.translate(this.x, this.y);
                ctx.rotate(this.rotation);
                const g = ctx.createRadialGradient(0, 0, this.size * 0.05, 0, 0, this.size);
                g.addColorStop(0.00, 'rgba(255,255,255,0.85)');
                g.addColorStop(0.22, 'rgba(255,255,255,0.45)');
                g.addColorStop(0.55, this.rim);
                g.addColorStop(1.00, 'rgba(255,255,255,0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(0, 0, this.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // Particle count scaled up ~20%
        const baseTarget = Math.round((window.innerWidth * window.innerHeight) / (700 * 200));
        const COUNT = Math.min(Math.max(Math.round(baseTarget * 1.2), 32), 140);
        const particles = Array.from({ length: COUNT }, () => new Particle());

        let last = performance.now();
        function step(now) {
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;

            ctx.clearRect(0, 0, w, h);
            // slightly lighter veil to avoid washing out smoke
            ctx.fillStyle = 'rgba(245,246,248,0.05)';
            ctx.fillRect(0, 0, w, h);

            for (let p of particles) { p.update(dt); p.draw(ctx); }
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
