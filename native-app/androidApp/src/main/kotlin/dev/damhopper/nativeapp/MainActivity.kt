package dev.damhopper.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import dev.damhopper.nativeapp.ui.screens.WorkbenchScreen
import dev.damhopper.nativeapp.ui.theme.NativeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            NativeTheme {
                WorkbenchScreen()
            }
        }
    }
}
