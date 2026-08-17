import './styles.css';
import { renderShell } from './ui/shell';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('#app container is missing from index.html');
}

renderShell(root);
