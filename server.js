import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { Server } from 'socket.io';
import { createServer } from 'http';

dotenv.config();

const PORT = process.env.PORT ?? 3000;

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.FE_PORT,
        methods: ["GET", "POST"] // initializing
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
        io.emit('chat message', msg, result.lastInsertRowid.toString(), username);
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
app.use(express.static('../build'));

app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '../build/index.html');
 // Change this to serve your React frontend if required
});

server.listen(PORT, () => {
    console.log('server running');
});
