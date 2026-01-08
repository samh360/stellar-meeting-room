// --- CONFIGURATION START ---
const firebaseConfig = {
    apiKey: "AIzaSyBtY4RgTKGO-dzIqhwDsXSMwQMFJFqjfX4",
    authDomain: "hq-meeting-room-booking.firebaseapp.com",
    projectId: "hq-meeting-room-booking",
    storageBucket: "hq-meeting-room-booking.firebasestorage.app",
    messagingSenderId: "149064353382",
    appId: "1:149064353382:web:3308a451797af911850fa7",
    measurementId: "G-SWKM009675"
};
// --- CONFIGURATION END ---

// Initialize Firebase (Compat)
// NOTE: We assume firebase-app-compat.js and firebase-firestore-compat.js are loaded in HTML
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Data Constants
const DEFAULT_ROOMS = [
    { id: 'hq-01', name: 'Nebula Suite', capacity: 12, location: 'Level 14, East Wing', description: 'Executive boardroom with panoramic views.', image: 'linear-gradient(45deg, #FF9A9E 0%, #FECFEF 99%, #FECFEF 100%)', services: ['WiFi', 'Projector', 'Video Conf'] },
    { id: 'hq-02', name: 'Quantum Lab', capacity: 6, location: 'Level 14, Core', description: 'Focus room optimized for tiny teams.', image: 'linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)', services: ['WiFi', 'Whiteboard'] },
    { id: 'hq-03', name: 'Stellar Pod', capacity: 4, location: 'Lobby Area', description: 'Soundproof pod for confidential calls.', image: 'linear-gradient(to top, #cfd9df 0%, #e2ebf0 100%)', services: ['Soundproof', 'Ventilation'] },
    { id: 'hq-04', name: 'Void Hall', capacity: 30, location: 'Basement Auditorium', description: 'Large presentation space for town halls.', image: 'linear-gradient(to right, #434343 0%, black 100%)', services: ['WiFi', 'Stage', 'Audio System', 'Projector'] }
];

// Global DataManager
window.DataManager = {
    // --- Auth Logic ---
    auth_state: null, // Holds current user

    initAuth: (callback) => {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    // Fetch Role from Firestore
                    const docRef = db.collection('users').doc(user.uid);
                    const doc = await docRef.get();

                    if (doc.exists) {
                        user.role = doc.data().role;
                    } else {
                        // Self-heal: Create missing user doc for legacy users
                        await docRef.set({
                            email: user.email,
                            role: 'staff',
                            uid: user.uid,
                            createdAt: firebase.firestore.Timestamp.now()
                        });
                        user.role = 'staff';
                    }
                } catch (e) {
                    console.error("Error fetching user role:", e);
                    user.role = 'staff';
                }
            }
            window.DataManager.auth_state = user;
            if (callback) callback(user);
        });
    },

    signIn: async (email, password) => {
        try {
            await auth.signInWithEmailAndPassword(email, password);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    signUp: async (email, password) => {
        try {
            const result = await auth.createUserWithEmailAndPassword(email, password);
            // Create initial user doc
            await db.collection('users').doc(result.user.uid).set({
                email: email,
                role: 'staff',
                uid: result.user.uid,
                createdAt: firebase.firestore.Timestamp.now()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    signOut: async () => {
        await auth.signOut();
    },

    isAdmin: () => {
        const user = window.DataManager.auth_state;
        // Failsafe: admin@hq.com is ALWAYS admin, even if DB says 'staff'
        return user && (user.role === 'admin' || user.email === 'admin@hq.com');
    },

    // --- DB Logic ---
    getRooms: async () => {
        try {
            const snapshot = await db.collection("rooms").get();
            const rooms = [];
            snapshot.forEach((doc) => {
                rooms.push({ id: doc.id, ...doc.data() });
            });

            // Fallback for first run if DB is empty, return defaults so we can seed them
            if (rooms.length === 0) return [];

            return rooms;
        } catch (e) {
            console.error("Error getting rooms: ", e);
            return [];
        }
    },

    // Admin: Seed Default Rooms
    seedRooms: async () => {
        const batch = db.batch();
        DEFAULT_ROOMS.forEach(room => {
            const docRef = db.collection("rooms").doc(room.id);
            batch.set(docRef, room);
        });
        await batch.commit();
    },

    // Admin: Add Room
    addRoom: async (roomData) => {
        // Generate simple ID if not provided
        if (!roomData.id) {
            roomData.id = 'room-' + Date.now();
        }
        await db.collection("rooms").doc(roomData.id).set(roomData);
    },

    // Admin: Delete Room
    deleteRoom: async (roomId) => {
        await db.collection("rooms").doc(roomId).delete();
    },

    getRoom: async (id) => {
        // Fetch single room from DB or cache? For now, fetch all is fine or single doc
        const doc = await db.collection("rooms").doc(id).get();
        if (doc.exists) return { id: doc.id, ...doc.data() };
        return null;
    },

    getBookings: async () => {
        try {
            const snapshot = await db.collection("bookings").get();
            const bookings = [];
            snapshot.forEach((doc) => {
                bookings.push({ id: doc.id, ...doc.data() });
            });
            return bookings;
        } catch (e) {
            console.error("Error getting documents: ", e);
            throw e;
        }
    },

    addBooking: async (booking) => {
        try {
            // 1. Conflict Check
            const snapshot = await db.collection("bookings")
                .where("roomId", "==", booking.roomId)
                .get();

            let hasConflict = false;

            snapshot.forEach(doc => {
                const b = doc.data();
                if (booking.startTime < b.endTime && booking.endTime > b.startTime) {
                    hasConflict = true;
                }
            });

            if (hasConflict) {
                return { success: false, error: 'Time slot already booked!' };
            }

            // 2. Save
            await db.collection("bookings").add({
                roomId: booking.roomId,
                user: booking.user,
                startTime: booking.startTime,
                endTime: booking.endTime,
                createdAt: firebase.firestore.Timestamp.now()
            });

            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    },

    deleteBooking: async (id) => {
        await db.collection("bookings").doc(id).delete();
    },

    getUserBookings: async (email) => {
        try {
            const snapshot = await db.collection("bookings")
                .where("user", "==", email)
                .get();

            const bookings = [];
            snapshot.forEach((doc) => {
                bookings.push({ id: doc.id, ...doc.data() });
            });
            return bookings;
        } catch (e) {
            console.error("Error getting user bookings:", e);
            throw e;
        }
    }
};
