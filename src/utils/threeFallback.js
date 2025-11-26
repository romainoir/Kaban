class Matrix4 {
  constructor() {
    this.elements = new Array(16).fill(0);
  }

  fromArray(array) {
    this.elements = Array.isArray(array) ? array : this.elements;
    return this;
  }

  makeTranslation() {
    return this;
  }

  scale() {
    return this;
  }

  multiply() {
    return this;
  }
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  setScalar(value) {
    this.x = value;
    this.y = value;
    this.z = value;
    return this;
  }

  multiply(vector) {
    this.x *= vector?.x ?? 1;
    this.y *= vector?.y ?? 1;
    this.z *= vector?.z ?? 1;
    return this;
  }
}

class Camera {}

class Scene {
  constructor() {
    this.scale = new Vector3(1, 1, 1);
  }

  rotateX() {}

  add() {}
}

class AmbientLight {
  constructor(color, intensity) {
    this.color = color;
    this.intensity = intensity;
  }
}

class DirectionalLight extends AmbientLight {
  constructor(color, intensity) {
    super(color, intensity);
    this.position = { set: () => ({ normalize: () => {} }) };
  }
}

class WebGLRenderer {
  constructor() {
    this.autoClear = true;
  }

  resetState() {}

  render() {}
}

const THREE = {
  Matrix4,
  Vector3,
  Camera,
  Scene,
  AmbientLight,
  DirectionalLight,
  WebGLRenderer,
};

class GLTFLoader {
  constructor() {
    this.isFallback = true;
  }

  async loadAsync() {
    return { scene: null };
  }
}

export { GLTFLoader };
export default THREE;
