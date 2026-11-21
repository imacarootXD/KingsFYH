const form = document.querySelector('#navigation');
const address = document.querySelector('#address');
const back = document.querySelector('#back');
const forward = document.querySelector('#forward');
const status = document.querySelector('#status');
const startPanel = document.querySelector('#start');
const errorPanel = document.querySelector('#error');
let displayedAddress = '';

form.addEventListener('submit', (event) => {
  event.preventDefault();
  window.rewind.open(address.value);
});
back.addEventListener('click', () => window.rewind.back());
forward.addEventListener('click', () => window.rewind.forward());

for (const button of document.querySelectorAll('[data-address]')) {
  button.addEventListener('click', () => window.rewind.open(button.dataset.address));
}

window.rewind.onState((state) => {
  if (state.address !== displayedAddress || (status.dataset.kind === 'loading' && state.kind !== 'loading')) {
    address.value = state.address;
  }
  displayedAddress = state.address;
  status.textContent = state.status;
  status.dataset.kind = state.kind;
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
  startPanel.hidden = state.kind !== 'start';
  errorPanel.hidden = state.kind !== 'error';
});
