const pb = new PocketBase('http://127.0.0.1:8090');

// Check if already logged in
if (pb.authStore.isValid && window.location.pathname === '/login') {
    window.location.href = '/';
}

const loginForm = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');
const toggleSignup = document.getElementById('toggleSignup');
let isSignup = false;

if (loginForm) {
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

// Logout helper
function logout() {
    pb.authStore.clear();
    window.location.href = '/login.html';
}

// Export for other modules if needed, or just global
window.pb = pb;
window.logout = logout;
