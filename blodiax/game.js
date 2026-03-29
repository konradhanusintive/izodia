// Importy z biblioteki Three.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- PODSTAWOWA KONFIGURACJA SCENY ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a); // Mroczne tło
scene.fog = new THREE.Fog(0x1a1a1a, 10, 50); // Mgła dla klimatu

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
// Ustawienie kamery w stylu izometrycznym, jak w Diablo
camera.position.set(0, 15, 15);
camera.rotation.x = -0.7;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; // Włączamy cienie
document.body.appendChild(renderer.domElement);

// --- OŚWIETLENIE ---
const ambientLight = new THREE.AmbientLight(0x404040, 2); // Miękkie światło otoczenia
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5); // Światło kierunkowe (jak słońce/księżyc)
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true; // To światło rzuca cień
scene.add(directionalLight);

// --- PODŁOŻE ---
// Duża płaszczyzna, na której będzie się toczyć akcja
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Obracamy, żeby leżała płasko
ground.receiveShadow = true; // Podłoże przyjmuje cienie
scene.add(ground);

// --- ZASOBY I ŁADOWANIE ---
const loadingManager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(loadingManager);
const clock = new THREE.Clock();

let player = null;
const monsters = [];
let animationMixers = []; // Tablica do przechowywania wszystkich mixerów animacji

loadingManager.onLoad = () => {
  // Ukryj ekran ładowania, gdy wszystko jest gotowe
  const loadingScreen = document.getElementById("loading-screen");
  loadingScreen.style.display = "none";

  // Inicjalizacja gry po załadowaniu modeli
  initGame();
};

// --- KLASA POSTACI (GRACZ I POTWORY) ---
class Character {
  constructor(scene, modelUrl, initialPosition) {
    this.model = null;
    this.mixer = null;
    this.animations = {};
    this.speed = 5;
    this.targetPosition = new THREE.Vector3().copy(initialPosition);
    this.isMoving = false;

    gltfLoader.load(modelUrl, (gltf) => {
      this.model = gltf.scene;
      this.model.position.copy(initialPosition);
      this.model.scale.set(1.5, 1.5, 1.5); // Można dostosować skalę

      // Przechodzimy przez model i ustawiamy, aby rzucał cień
      this.model.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
        }
      });

      scene.add(this.model);

      // Setup animacji
      this.mixer = new THREE.AnimationMixer(this.model);
      gltf.animations.forEach((clip) => {
        this.animations[clip.name] = this.mixer.clipAction(clip);
      });

      // Domyślna animacja
      if (this.animations["Idle"]) {
        this.playAnimation("Idle");
      }

      animationMixers.push(this.mixer);
    });
  }

  playAnimation(name) {
    if (!this.animations[name]) return;

    // Płynne przejście między animacjami
    const currentAnimation = this.activeAnimation;
    this.activeAnimation = this.animations[name];

    if (currentAnimation && currentAnimation !== this.activeAnimation) {
      currentAnimation.fadeOut(0.2);
    }

    this.activeAnimation.reset().fadeIn(0.2).play();
  }

  update(deltaTime) {
    if (!this.model) return;

    // Logika poruszania się
    const distanceToTarget = this.model.position.distanceTo(
      this.targetPosition
    );

    if (distanceToTarget > 0.1) {
      this.isMoving = true;

      // Płynne obracanie się postaci w kierunku celu
      const direction = new THREE.Vector3()
        .subVectors(this.targetPosition, this.model.position)
        .normalize();
      const angle = Math.atan2(direction.x, direction.z);
      this.model.rotation.y = angle;

      this.model.position.add(direction.multiplyScalar(this.speed * deltaTime));

      this.playAnimation("Walk"); // Zakładamy, że animacja nazywa się 'Walk'
    } else if (this.isMoving) {
      this.isMoving = false;
      this.playAnimation("Idle"); // Zakładamy, że animacja nazywa się 'Idle'
    }
  }
}

// --- KLASA GRACZA (rozszerza Character) ---
class Player extends Character {
  constructor(scene, modelUrl, initialPosition) {
    super(scene, modelUrl, initialPosition);
    this.speed = 6; // Gracz jest trochę szybszy
  }
}

// --- KLASA POTWORA (rozszerza Character) ---
class Monster extends Character {
  constructor(scene, modelUrl, initialPosition, player) {
    super(scene, modelUrl, initialPosition);
    this.player = player;
    this.attackRange = 2.5; // Zasięg ataku
    this.detectionRange = 20; // Zasięg wykrywania gracza
    this.speed = 4;
  }

  update(deltaTime) {
    if (!this.model || !this.player || !this.player.model) return;

    const distanceToPlayer = this.model.position.distanceTo(
      this.player.model.position
    );

    if (distanceToPlayer < this.detectionRange) {
      if (distanceToPlayer > this.attackRange) {
        // Gracz jest w zasięgu, ale za daleko by atakować - idź w jego stronę
        this.targetPosition.copy(this.player.model.position);
        super.update(deltaTime); // Używamy logiki ruchu z klasy nadrzędnej
      } else {
        // Gracz jest w zasięgu ataku
        if (this.isMoving) {
          this.isMoving = false;
        }
        // Obróć się w stronę gracza
        const direction = new THREE.Vector3()
          .subVectors(this.player.model.position, this.model.position)
          .normalize();
        const angle = Math.atan2(direction.x, direction.z);
        this.model.rotation.y = angle;

        this.playAnimation("Attack"); // Odtwórz animację ataku
      }
    } else {
      // Gracz jest za daleko, stój w miejscu
      if (this.isMoving) {
        this.isMoving = false;
        this.playAnimation("Idle");
      }
    }
  }
}

// --- LOGIKA KLIKNIĘCIA MYSZKĄ (Nawigacja) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener("mousedown", (event) => {
  // Obsługujemy tylko lewy przycisk myszy
  if (event.button !== 0 || !player) return;

  // Konwertujemy pozycję myszy na współrzędne w systemie Three.js (-1 do 1)
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Sprawdzamy, czy promień przecina się z podłożem
  const intersects = raycaster.intersectObject(ground);

  if (intersects.length > 0) {
    // Ustawiamy cel ruchu gracza na punkt kliknięcia
    const point = intersects[0].point;
    player.targetPosition.copy(point);
  }
});

// --- INICJALIZACJA I GŁÓWNA PĘTLA GRY ---
function initGame() {
  player = new Player(scene, "assets/player.glb", new THREE.Vector3(0, 0, 0));

  // Stwórz kilka potworów
  for (let i = 0; i < 5; i++) {
    const x = (Math.random() - 0.5) * 40;
    const z = (Math.random() - 0.5) * 40;
    const monster = new Monster(
      scene,
      "assets/monster.glb",
      new THREE.Vector3(x, 0, z),
      player
    );
    monsters.push(monster);
  }

  animate(); // Rozpocznij pętlę gry
}

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = clock.getDelta();

  // Aktualizacja wszystkich mixerów animacji
  for (const mixer of animationMixers) {
    mixer.update(deltaTime);
  }

  // Aktualizacja gracza
  if (player) {
    player.update(deltaTime);
    // Kamera podąża za graczem w sposób płynny
    const cameraOffset = new THREE.Vector3(0, 15, 15);
    camera.position.lerp(player.model.position.clone().add(cameraOffset), 0.05);
  }

  // Aktualizacja potworów
  for (const monster of monsters) {
    monster.update(deltaTime);
  }

  renderer.render(scene, camera);
}

// Obsługa zmiany rozmiaru okna
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
