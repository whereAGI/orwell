const pb = new PocketBase(window.ORWELL_CONFIG?.pocketbase_url || 'http://127.0.0.1:8090');

// Local-only mode: Auto-login as admin on startup
// This bypasses the need for user interaction, making it feel like a local desktop app.
(async function() {
    if (!pb.authStore.isValid) {
        try {
            // Use default admin credentials (matching backend defaults)
            await pb.admins.authWithPassword('admin@orwell.com', '1234567890');
            console.log("Auto-authenticated as admin (Local Mode)");
            
            // Redirect to home if on login page
            if (window.location.pathname === '/login') {
                window.location.href = '/';
            }
        } catch (err) {
            console.error("Auto-login failed:", err);
        }
    } else {
        // Already valid, redirect if on login page
        if (window.location.pathname === '/login') {
            window.location.href = '/';
        }
    }
})();

const loginForm = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');
const toggleSignup = document.getElementById('toggleSignup');
let isSignup = false;

if (loginForm) {
    // ... existing login form logic (kept for fallback/cloud mode if enabled later) ...
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        errorMsg.classList.add('hidden');
        errorMsg.textContent = '';

        try {
            if (isSignup) {
                await pb.collection('users').create({
                    email: email,
                    password: password,
                    passwordConfirm: password,
                });
                // Auto login after signup
                await pb.collection('users').authWithPassword(email, password);
            } else {
                await pb.collection('users').authWithPassword(email, password);
            }

            window.location.href = '/';
        } catch (err) {
            console.error(err);
            errorMsg.textContent = isSignup ? "Signup failed. Email might be taken." : "Invalid email or password.";
            errorMsg.classList.remove('hidden');
        }
    });

    toggleSignup.addEventListener('click', (e) => {
        e.preventDefault();
        isSignup = !isSignup;
        const btn = loginForm.querySelector('button[type="submit"]');
        const title = document.querySelector('h1');
        const subtitle = document.querySelector('p.text-gray-500');

        if (isSignup) {
            btn.textContent = "Sign up";
            title.textContent = "Create Account";
            subtitle.textContent = "Get started with Orwell";
            toggleSignup.textContent = "Already have an account? Sign in";
        } else {
            btn.textContent = "Sign in";
            title.textContent = "Orwell";
            subtitle.textContent = "Sign in to access the platform";
            toggleSignup.textContent = "Sign up";
        }
    });
}

// Logout helper (Disabled in local mode UI, but kept in code)
function logout() {
    pb.authStore.clear();
    window.location.href = '/login'; // Changed from login.html to /login
}

// Export for other modules if needed, or just global
window.pb = pb;
window.logout = logout;
