import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDxRz_k38Ys7a-77Ml2AOfQmo9St4JQK5k",
  authDomain: "invoice-builder-33a11.firebaseapp.com",
  projectId: "invoice-builder-33a11",
  storageBucket: "invoice-builder-33a11.firebasestorage.app",
  messagingSenderId: "700247427935",
  appId: "1:700247427935:web:6a83a50b7c2552d8ecc4ea",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
