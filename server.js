import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import session from 'express-session';
import logger from 'morgan';
import dotenv from 'dotenv';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@libsql/client';
import { Server } from 'socket.io';
import { createServer } from 'http';

dotenv.config();

const PORT = process.env.PORT || 3001;

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
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
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT,
                email TEXT,
                profile_picture TEXT
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT,
                user_id TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);

        console.log('Database initialized successfully.');
    } catch (error) {
        console.error('Error initializing the database:', error);
    }
}

initDatabase();

io.on('connection', async (socket) => {
    socket.on('chat message', async (msg) => {
        console.log('Chat message event received:', msg);
        let result;
        try {
            console.log('Executing SQL query...');
            result = await db.execute({
                sql: 'INSERT INTO messages (user_id, content) VALUES (:userId, :content)',
                args: { userId: msg.userId, content: msg.content }
            });
            console.log('SQL query executed successfully:', result);
        } catch (e) {
            console.error('Error executing SQL query:', e);
            console.error(e);
            return;
        }
        console.log('Emitting chat message event...');
        io.emit('chat message', msg, result.lastInsertRowid.toString(), content);
        console.log('Chat message event emitted successfully');
    });

    if (!socket.recovered) {
        try {
            const results = await db.execute('SELECT id, content, user_id user FROM messages');

            results.rows.forEach(row => {
                socket.emit('chat message', row.content, row.id.toString(), row.user);
            });
        } catch (error) {
            console.error(error);
        }
    }
});

app.use(logger('dev'));
app.use(cors({
    origin: 'http://localhost:3001',
    credentials: true
  }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => {
    done(null, user.id);    
});

passport.deserializeUser((id, done) => {
    // Find the user with the given id in your database
    db.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [id]
    }).then(result => {
        if (result.rows.length > 0) {
            done(null, result.rows[0]);
        } else {
            done(new Error('User not found'));
        }
    }).catch(err => {
        done(err);
    });
});

// If you're serving the React frontend using the same Express server:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['profile', 'email']
  },
  async function(accessToken, refreshToken, profile, cb) {
    // Find or create the user in your database
    let user;
    try {
        // Try to find the user in the database
        const result = await db.execute({
            sql: 'SELECT * FROM users WHERE id = ?',
            args: [profile.id]
        });

        if (result.rows.length > 0) {
            // The user exists in the database
            user = result.rows[0];
        } else {
            // The user doesn't exist in the database, so create a new user
            const result = await db.execute({
                sql: 'INSERT INTO users (id, username, email) VALUES (?, ?, ?)',
                args: [profile.id, profile.displayName, profile.emails[0].value]
            });

            user = { id: profile.id, username: profile.displayName, email: profile.emails[0].value };
        }
    } catch (err) {
        return cb(err);
    }

    return cb(null, user);
  }
));

app.get('/api/user', function(req, res) {
    if (req.session.user) {
      res.json(req.session.user);
    } else {
      res.status(401).json({ message: 'Not logged in' });
    }
  });

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  async function(req, res) {
    console.log('passed 1')
    // User has successfully authenticated with Google
    let googleId = req.user.id;
    console.log('passed 2', googleId)
    try {
      // Try to find a user with the same Google ID
      const results = await db.execute({
        sql: 'SELECT * FROM users WHERE id = :id',
        args: { id: googleId }
      });
      if (results.rows.length > 0) {
        console.log('user found, use the user data')
        const user = results.rows[0];
        req.session.user = user;
    } else {
        console.log('user not found, create a new user')
        const result = await db.execute({
            sql: 'INSERT INTO users (id, username, email, profile_picture) VALUES (:googleId, :username, :email, :profile_picture)',
            args: { googleId, username: req.user.displayName, email: req.user.emails[0].value, profile_picture: req.user.photos[0].value }
          });
          
          if (result.rowCount === 1) {
            console.log('User was inserted successfully');
          } else {
            console.log('User was not inserted');
          }
        // Use the new user data
        const user = { id: googleId, username: req.user.displayName, email: req.user.emails[0].value, profile_picture: req.user.photos[0].value };
        req.session.user = user;
      }
    } catch (error) {
      console.error(error);
    }

    // Redirect to the frontend application
    res.redirect('http://localhost:3001');
  }
);

app.use(express.static(path.join(__dirname, '../delmochat/build')));

app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../delmochat/build', 'index.html'));
});

server.listen(PORT, () => {
    console.log('server running in port', PORT);
});
