import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'shapes-colors-api',
      configureServer(server) {
        // API endpoint to discover shapes and palettes dynamically from directory
        server.middlewares.use('/api/assets', (req, res, next) => {
          if (req.method !== 'GET') {
            return next();
          }
          const shapesDir = path.resolve(__dirname, 'Shapes_Colors');
          try {
            const files = fs.readdirSync(shapesDir);
            const pngFiles = files.filter(f => f.toLowerCase().endsWith('.png'));
            
            const palettes = pngFiles
              .filter(f => f.toLowerCase().includes('palette'))
              .map(f => {
                const name = path.parse(f).name.replace(/_/g, ' ');
                return {
                  id: path.parse(f).name,
                  filename: f,
                  name: name,
                  url: `/Shapes_Colors/${encodeURIComponent(f)}`
                };
              });

            const shapes = pngFiles
              .filter(f => !f.toLowerCase().includes('palette'))
              .map(f => {
                const name = path.parse(f).name.replace(/_/g, ' ');
                return {
                  id: path.parse(f).name,
                  filename: f,
                  name: name,
                  url: `/Shapes_Colors/${encodeURIComponent(f)}`
                };
              });

            // Also include any project-owned derived shapes (e.g. Cross)
            const derivedDir = path.resolve(__dirname, 'DerivedShapes');
            if (fs.existsSync(derivedDir)) {
              const derivedFiles = fs.readdirSync(derivedDir).filter(f => f.toLowerCase().endsWith('.png'));
              for (const f of derivedFiles) {
                const id = path.parse(f).name;
                const name = id.replace(/_/g, ' ');
                shapes.push({
                  id,
                  filename: f,
                  name,
                  url: `/DerivedShapes/${encodeURIComponent(f)}`
                });
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ shapes, palettes }));
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });

        // Serve the Shapes_Colors folder directly
        server.middlewares.use('/Shapes_Colors', (req, res, next) => {
          const filePath = path.resolve(__dirname, 'Shapes_Colors', decodeURIComponent(req.url?.replace(/^\//, '') || ''));
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.png') res.setHeader('Content-Type', 'image/png');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });

        // Serve the DerivedShapes folder directly
        server.middlewares.use('/DerivedShapes', (req, res, next) => {
          const filePath = path.resolve(__dirname, 'DerivedShapes', decodeURIComponent(req.url?.replace(/^\//, '') || ''));
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.png') res.setHeader('Content-Type', 'image/png');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      }
    }
  ],
  server: {
    port: 5173,
    host: true
  }
});
