// TREMORGUARD firmware - copy of "Final paper edits/MPU6050/MPU6050.ino".
// Only change: optional SEND_GYRO output (off by default, so the serial format
// stays EMG,AX,AY,AZ,MAG and the original combine.py keeps working).

#include <Wire.h>
#include <math.h>
#include <ESP32Servo.h>

//  EMG 
#define SENSOR_PIN 34
#define LED_PIN 2

//  MPU6050 
#define MPU 0x68

//  SETTINGS 
#define BAUD_RATE 115200
#define SAMPLE_RATE 100
#define SAMPLE_INTERVAL (1000000UL / SAMPLE_RATE)
#define THRESHOLD 2200

//  SERVO 1: GPIO 18 
#define SERVO1_PIN 18
#define SERVO1_REST 0
#define SERVO1_ENGAGED 60

//  SERVO 2: GPIO 19 
#define SERVO2_PIN 19
#define SERVO2_REST 60
#define SERVO2_ENGAGED 0

//  SERVO SETTINGS 
#define SERVO_STEP 2.0
#define FAILSAFE_MS 3000

//  OPTIONAL GYRO OUTPUT 
// Uncomment to append GX,GY,GZ (deg/s) to every line:
//   EMG,AX,AY,AZ,MAG,GX,GY,GZ
// The dashboard accepts both formats. The original combine.py needs exactly 5 fields.
// #define SEND_GYRO

//  OPTIONAL STABILIZATION 
// Uncomment to enable stabilization mode
// #define MODE_STABILIZE

#define STAB_GAIN 1.0
#define STAB_STEP 10.0
#define COMP_ALPHA 0.98

//  TIMING 
unsigned long lastSampleTime = 0;
unsigned long lastCmdTime = 0;

//  MPU VARIABLES 
int16_t ax, ay, az, gx, gy, gz;

//  SERVOS 
Servo servo1;
Servo servo2;

bool suppress = false;

float servo1Pos = SERVO1_REST;
float servo2Pos = SERVO2_REST;

// Tilt angle
float angle = 0.0;

//  READ 16-BIT VALUE 
int16_t read16() {
  uint16_t hi = (uint8_t)Wire.read();
  uint16_t lo = (uint8_t)Wire.read();

  return (int16_t)((hi << 8) | lo);
}

//  SETUP 
void setup() {
  Serial.begin(BAUD_RATE);

  // LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // ESP32 ADC
  analogReadResolution(12);

  //  SERVO INITIALIZATION 
  servo1.setPeriodHertz(50);
  servo1.attach(SERVO1_PIN, 500, 2400);
  servo1.write(SERVO1_REST);

  servo2.setPeriodHertz(50);
  servo2.attach(SERVO2_PIN, 500, 2400);
  servo2.write(SERVO2_REST);

  servo1Pos = SERVO1_REST;
  servo2Pos = SERVO2_REST;

  //  I2C INITIALIZATION 
  Wire.begin(21, 22);

  // Wake up MPU6050
  Wire.beginTransmission(MPU);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission(true);

  delay(1000);

  lastCmdTime = millis();
  lastSampleTime = micros();

  Serial.println("SYSTEM READY");
}

//  MAIN LOOP 
void loop() {

  // 0. SERIAL COMMANDS FROM PYTHON
  // '1' = engage
  // '0' = release
  while (Serial.available() > 0) {
    char c = Serial.read();

    if (c == '1') {
      suppress = true;
      lastCmdTime = millis();
    }
    else if (c == '0') {
      suppress = false;
      lastCmdTime = millis();
    }
  }

  // Failsafe: release if commands stop arriving
  if (millis() - lastCmdTime > FAILSAFE_MS) {
    suppress = false;
  }

  // SAMPLE TIMING
  unsigned long currentTime = micros();

  if (currentTime - lastSampleTime < SAMPLE_INTERVAL) {
    return;
  }

  lastSampleTime = currentTime;

  // 1. READ EMG
  int emgVal = analogRead(SENSOR_PIN);

  // 2. READ MPU6050
  // Read 14 bytes starting at register 0x3B
  Wire.beginTransmission(MPU);
  Wire.write(0x3B);

  if (Wire.endTransmission(false) != 0) {
    return;
  }

  uint8_t bytesReceived = Wire.requestFrom(MPU, (uint8_t)14, (uint8_t)true);

  // Process sensor data only if all 14 bytes arrive
  if (bytesReceived != 14 || Wire.available() < 14) {
    while (Wire.available() > 0) {
      Wire.read();
    }
    return;
  }

  ax = read16();
  ay = read16();
  az = read16();

  read16();       // Temperature
  gx = read16();  // Gyroscope X

  gy = read16();  // Gyroscope Y
  gz = read16();  // Gyroscope Z

  // 3. CONVERT ACCELEROMETER VALUES
  float ax_g = ax / 16384.0f;
  float ay_g = ay / 16384.0f;
  float az_g = az / 16384.0f;

  // Acceleration magnitude
  float mag = sqrtf(
    ax_g * ax_g +
    ay_g * ay_g +
    az_g * az_g
  );

  // 4. TILT ANGLE: COMPLEMENTARY FILTER
  const float dt = 1.0f / SAMPLE_RATE;

  float accAngle = atan2f(ay_g, az_g) * 180.0f / PI;
  float gyroRate = gx / 131.0f;

  angle = COMP_ALPHA * (angle + gyroRate * dt)
        + (1.0f - COMP_ALPHA) * accAngle;

  // 5. LED LOGIC
  digitalWrite(
    LED_PIN,
    (emgVal > THRESHOLD) ? HIGH : LOW
  );

  // 6. SERVO CONTROL
  // Independent target and position for each servo
  float target1 = SERVO1_REST;
  float target2 = SERVO2_REST;

  float step = SERVO_STEP;

  if (suppress) {
    #ifdef MODE_STABILIZE
      target1 = SERVO1_REST - angle * STAB_GAIN;
      target2 = SERVO2_REST + angle * STAB_GAIN;
      step = STAB_STEP;
    #else
      target1 = SERVO1_ENGAGED;
      target2 = SERVO2_ENGAGED;
    #endif
  }

  // Constrain each servo to its configured range
  target1 = constrain(
    target1,
    (float)min(SERVO1_REST, SERVO1_ENGAGED),
    (float)max(SERVO1_REST, SERVO1_ENGAGED)
  );

  target2 = constrain(
    target2,
    (float)min(SERVO2_REST, SERVO2_ENGAGED),
    (float)max(SERVO2_REST, SERVO2_ENGAGED)
  );

  // Smooth movement of servo 1
  if (servo1Pos < target1) {
    servo1Pos = fminf(servo1Pos + step, target1);
  }
  else if (servo1Pos > target1) {
    servo1Pos = fmaxf(servo1Pos - step, target1);
  }

  // Smooth movement of servo 2
  if (servo2Pos < target2) {
    servo2Pos = fminf(servo2Pos + step, target2);
  }
  else if (servo2Pos > target2) {
    servo2Pos = fmaxf(servo2Pos - step, target2);
  }

  // Write independent angles
  servo1.write(constrain((int)servo1Pos, 0, 180));
  servo2.write(constrain((int)servo2Pos, 0, 180));

  // 7. SERIAL OUTPUT
  // Format unchanged: EMG,AX,AY,AZ,MAG
  Serial.print(emgVal);
  Serial.print(",");

  Serial.print(ax_g, 4);
  Serial.print(",");

  Serial.print(ay_g, 4);
  Serial.print(",");

  Serial.print(az_g, 4);
  Serial.print(",");

#ifdef SEND_GYRO
  Serial.print(mag, 4);
  Serial.print(",");
  Serial.print(gx / 131.0f, 2);
  Serial.print(",");
  Serial.print(gy / 131.0f, 2);
  Serial.print(",");
  Serial.println(gz / 131.0f, 2);
#else
  Serial.println(mag, 4);
#endif
}
