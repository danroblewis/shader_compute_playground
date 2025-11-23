float rand(vec2 co){
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

float getState(float x, float y) {
    return texture(ping, v_texCoord + vec2(x, y)).r;
}

float conway(float s) {
    float up = getState(0.0, s);
    float self = getState(0.0, 0.0);
    float down = getState(0.0, -s);
    float left = getState(0.0, -s);
    float right = getState(0.0, -s);

    if (self < 0.5) {
        if (up > 0.5) {
            return up;
        }
    }
    if (self >= 0.5) {
        if (down < 0.5) {
            return down;
        }
    }

    return self;
}

vec4 compute() {
    float s = 1.0 / float(textureSize(ping,0).x);
    return vec4(conway(s), 0.0, 0.0, 1.0);
}



