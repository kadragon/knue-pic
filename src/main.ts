import './styles.css';
import { bootstrap } from './ui/bootstrap';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('#app container is missing from index.html');
}

void bootstrap(root);
