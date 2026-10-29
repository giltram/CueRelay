// Development-only rendered-output observer. No microphone, file upload or production imports.
class AuditionCapture extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      if (input[channel]) output[channel].set(input[channel]);
    }
    this.port.postMessage({ frame: currentFrame, channels: input.map(channel => channel.slice()) });
    return true;
  }
}
registerProcessor('audition-capture', AuditionCapture);
