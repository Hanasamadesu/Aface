from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression

import numpy as np
import tensorflow as tf

import kagglehub

#Menjalan Model di thread berikutnya
def ModelL():
    print("[ML/I] Starting..")
    path = kagglehub.dataset_download("grassknoted/asl-alphabet")
    print("Path to dataset files:", path)