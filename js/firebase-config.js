// Beadazzle — Firebase & Firestore initialization
// Replace the placeholder values below with your Firebase project configuration.
// Found in the Firebase Console: Project Settings -> General -> "Your apps" -> Web app

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    getDoc,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC7Ip1e1g_UuS52hZXRPxj5Uc7RV5IvPJQ",
    authDomain: "beadazzle.firebaseapp.com",
    projectId: "beadazzle",
    storageBucket: "beadazzle.firebasestorage.app",
    messagingSenderId: "829008323207",
    appId: "1:829008323207:web:df98ae8e93f27977560e22"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
    db,
    collection,
    doc,
    setDoc,
    getDoc,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp
};
