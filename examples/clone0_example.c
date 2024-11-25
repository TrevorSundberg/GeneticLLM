#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int sortNumberArray(int* arr, size_t length) {
  for (size_t i = 0; i < length; i++) {
    for (size_t j = 0; j < length - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        int temp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = temp;
      }
    }
  }
  return 0;
}

int main() {
  char buffer[256];
  if (fgets(buffer, sizeof(buffer), stdin) != NULL) {
    int* numbers = calloc(16, sizeof(int));
    size_t num_elements = 0;
    char* token = strtok(buffer, ",");
    while (token != NULL && num_elements < 16) {
      int number = strtol(token, NULL, 10);
      numbers[num_elements++] = number;
      token = strtok(NULL, ",");
    }

    sortNumberArray(numbers, num_elements);

    for (size_t i = 0; i < num_elements; i++) {
      printf("%d", numbers[i]);
      if (i + 1 != num_elements) printf(", ");
    }
    printf("\n");

    free(numbers);
  }
  return 0;
}