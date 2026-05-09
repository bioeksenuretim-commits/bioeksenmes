/**
 * Firebase Configuration
 * Reaksiyon Strip Talep Takip Sistemi
 */

const firebaseConfig = {
    apiKey: "AIzaSyDjlBmMbRMCS0qbiuQmIzLp0PNhtgjyGp8",
    authDomain: "reaksiyontalep.firebaseapp.com",
    databaseURL: "https://reaksiyontalep-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "reaksiyontalep",
    storageBucket: "reaksiyontalep.firebasestorage.app",
    messagingSenderId: "333658933499",
    appId: "1:333658933499:web:a207663a668b4903bfc85e",
    measurementId: "G-KNH20BB8S6"
};

// Firebase'i başlat
var firebaseApp = typeof firebaseApp !== 'undefined' ? firebaseApp : null;
var firebaseReady = typeof firebaseReady !== 'undefined' ? firebaseReady : false;

try {
    if (typeof firebase !== 'undefined') {
        firebaseApp = firebase.initializeApp(firebaseConfig);
        firebaseReady = true;
        console.log('Firebase başlatıldı');
    } else {
        console.warn('Firebase SDK yüklenemedi.');
    }
} catch (error) {
    console.error('Firebase başlatma hatası:', error);
    firebaseReady = false;
}
