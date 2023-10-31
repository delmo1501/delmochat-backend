import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@libsql/client';
import { Server } from 'socket.io';
import { createServer } from 'http';

dotenv.config();

const PORT =  process.env.FRONTEND_URL;

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL,
        methods: ["GET", "POST"]
    },
    connectionStateRecovery: {}
});

const db = createClient({
    url: "libsql://genuine-savant-delmo1501.turso.io",
    authToken: process.env.DB_TOKEN,
});

async function initDatabase() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT,
                user TEXT
            )
        `);
        console.log('Database initialized successfully.');
    } catch (error) {
        console.error('Error initializing the database:', error);
    }
}

initDatabase();

io.on('connection', async (socket) => {
    console.log('user connected!');

    socket.on('disconnect', () => {
        console.log('user disconnected!');
    });

    socket.on('chat message', async (msg) => {
        console.log('entered');
        let result;
        let username = socket.handshake.auth.username ?? 'anonymous';
        console.log('jejeje', { username });
        try {
            result = await db.execute({
                sql: 'INSERT INTO messages (content, user) VALUES (:msg, :username)',
                args: { msg, username }
            });
        } catch (e) {
            console.error(e);
            return;
        }
        socket.broadcast.emit('chat message', msg, result.lastInsertRowid.toString(), username);
    });

    if (!socket.recovered) {
        try {
            const results = await db.execute({
                sql: 'SELECT id, content, user FROM messages WHERE id > ?',
                args: [socket.handshake.auth.serverOffset ?? 0]
            });

            results.rows.forEach(row => {
                socket.emit('chat message', row.content, row.id.toString(), row.user);
            });
        } catch (error) {
            console.error(error);
        }
    }
});

app.use(logger('dev'));

// If you're serving the React frontend using the same Express server:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../delmochat/build')));


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../delmochat-frontend/build', 'index.html'));
});


server.listen(PORT, () => {
    console.log('server running');
});
