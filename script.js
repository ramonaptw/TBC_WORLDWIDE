document.getElementById('cta-button').addEventListener('click', () => {
    document.getElementById('about').scrollIntoView({ behavior: 'smooth' });
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        target.scrollIntoView({ behavior: 'smooth' });
    });
});

document.getElementById('contact-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;

    console.log('Formular abgesendet:', { name, email, message });
    alert(`Danke ${name}! Deine Nachricht wurde gesendet.`);
    e.target.reset();
});
