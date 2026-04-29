import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Firebase project keys
const firebaseConfig = {
  apiKey: "AIzaSyB29wAFr31z0qqtmqWSTt0SDLAn_-HIfbA",
  authDomain: "spades-live-2dfe5.firebaseapp.com",
  projectId: "spades-live-2dfe5",
  databaseURL: "https://spades-live-2dfe5-default-rtdb.firebaseio.com/",
  storageBucket: "spades-live-2dfe5.firebasestorage.app",
  messagingSenderId: "446501530042",
  appId: "1:446501530042:web:6faba4d0fd9b978af59583",
  measurementId: "G-Q7669WYD64"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
export const db = getDatabase(app);
